use glideapi::{App, Config, FromRequest, Request, Response, State};
use glideapi_macros::{get, post};
use rand::Rng;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::process::Command;
use uuid::Uuid;

// ── Storage dir ───────────────────────────────────────────────────────────────

fn storage_dir() -> String {
    std::env::var("VIDPRESS_STORAGE").unwrap_or_else(|_| "/tmp/vidpress_output".into())
}

fn db_path() -> String {
    std::env::var("VIDPRESS_DB").unwrap_or_else(|_| "/tmp/vidpress.db".into())
}

/// Directory raw uploads land in via /ingest — deliberately not configurable
/// (see ingest()), so path validation below can pin against it exactly.
const INGEST_DIR: &str = "/tmp";
const INGEST_PREFIX: &str = "vidpress_";

/// Reject any client-supplied `path` that isn't a file we ourselves wrote via
/// /ingest. Without this, /analyze and /upload would hand ffprobe/ffmpeg
/// whatever path a caller sends — including protocol handlers like http://,
/// concat:, or subfile: — turning them into an SSRF / arbitrary-local-file
/// read primitive (feed /etc/passwd or an internal URL, then fetch the
/// "compressed" result back via /download/:id).
fn validate_ingest_path(raw: &str) -> Result<String, Response> {
    let bad = || Response { status: 400, body: r#"{"error":"invalid path"}"#.into(), ..Default::default() };
    let canonical = std::fs::canonicalize(raw).map_err(|_| bad())?;
    let ingest_dir = std::fs::canonicalize(INGEST_DIR).map_err(|_| bad())?;
    let file_name_ok = canonical.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with(INGEST_PREFIX))
        .unwrap_or(false);
    if !canonical.starts_with(&ingest_dir) || !file_name_ok {
        return Err(bad());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

/// Basic SSRF guard for user-supplied outbound URLs (webhook_url, and the
/// `url` /download-url hands to yt-dlp). Restricts to http/https and rejects
/// targets that resolve to loopback/private/link-local addresses — closes
/// the easy path to internal services and cloud metadata endpoints (e.g.
/// 169.254.169.254). Not a substitute for network-level egress controls,
/// and doesn't defend against DNS rebinding after this check passes.
async fn validate_outbound_url(raw: &str) -> Result<(), &'static str> {
    let url = reqwest::Url::parse(raw).map_err(|_| "invalid url")?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("only http/https urls are allowed");
    }
    let host = url.host_str().ok_or("missing host")?;
    let port = url.port_or_known_default().unwrap_or(443);
    let mut addrs = tokio::net::lookup_host((host, port)).await
        .map_err(|_| "could not resolve host")?
        .peekable();
    if addrs.peek().is_none() { return Err("could not resolve host"); }
    for addr in addrs {
        if is_disallowed_ip(&addr.ip()) {
            return Err("url resolves to a disallowed address");
        }
    }
    Ok(())
}

fn is_disallowed_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local()
                || v4.is_broadcast() || v4.is_documentation() || v4.is_unspecified()
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        }
    }
}

// ── DB ────────────────────────────────────────────────────────────────────────

fn init_db(conn: &Connection) {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'queued',
            media_kind TEXT NOT NULL,
            input_path TEXT NOT NULL,
            output_path TEXT NOT NULL,
            original_bytes INTEGER NOT NULL DEFAULT 0,
            compressed_bytes INTEGER NOT NULL DEFAULT 0,
            duration_secs REAL NOT NULL DEFAULT 0,
            progress INTEGER NOT NULL DEFAULT 0,
            eta_secs INTEGER NOT NULL DEFAULT 0,
            webhook_url TEXT,
            preset TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            url TEXT NOT NULL,
            status INTEGER,
            attempted_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS api_keys (
            key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'free',
            webhook_url TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS rate_limit (
            ip TEXT NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_ts ON rate_limit(ip, ts);
        CREATE TABLE IF NOT EXISTS transcriptions (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            text TEXT NOT NULL,
            language TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
    ").expect("db init failed");

    // Migrations — safe to run repeatedly
    conn.execute_batch("
        ALTER TABLE api_keys ADD COLUMN white_label_domain TEXT;
        ALTER TABLE api_keys ADD COLUMN white_label_brand TEXT;
    ").ok(); // ok() — will fail silently if columns already exist
    conn.execute_batch("
        CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_domain ON api_keys(white_label_domain) WHERE white_label_domain IS NOT NULL;
    ").ok();
}

type Db = Arc<Mutex<Connection>>;

// ── Rate limiting (sliding window, 30 req/min free, 300 req/min premium) ─────

fn rate_check(db: &Db, ip: &str, limit: u32) -> bool {
    let conn = db.lock().unwrap();
    let window = chrono_now() - 60;
    conn.execute("DELETE FROM rate_limit WHERE ts < ?1", params![window]).ok();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM rate_limit WHERE ip=?1 AND ts>=?2",
        params![ip, window], |r| r.get(0)
    ).unwrap_or(0);
    if count >= limit as i64 { return false; }
    conn.execute("INSERT INTO rate_limit(ip,ts) VALUES(?1,?2)", params![ip, chrono_now()]).ok();
    true
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── API key helpers ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
struct ApiKey {
    key: String,
    name: String,
    plan: String,
    webhook_url: Option<String>,
}

fn generate_api_key() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.gen::<u8>()).collect();
    format!("vp_{}", hex::encode_upper(&bytes[..16]))
}

fn lookup_api_key(db: &Db, key: &str) -> Option<ApiKey> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT key,name,plan,webhook_url FROM api_keys WHERE key=?1",
        params![key],
        |r| Ok(ApiKey { key: r.get(0)?, name: r.get(1)?, plan: r.get(2)?, webhook_url: r.get(3)? })
    ).ok()
}

fn extract_ip(req: &Request) -> String {
    req.headers.get("x-forwarded-for")
        .or_else(|| req.headers.get("x-real-ip"))
        .cloned()
        .unwrap_or_else(|| "unknown".into())
}

fn auth_and_rate(req: &Request, db: &Db) -> Result<Option<ApiKey>, Response> {
    let key_header = req.headers.get("x-api-key").cloned();
    if let Some(k) = key_header {
        match lookup_api_key(db, &k) {
            Some(ak) => {
                let limit = match ak.plan.as_str() {
                    "premium" => 300,
                    "api_starter" => 120,
                    "api_growth" => 600,
                    "api_scale" | "whitelabel" => 3000,
                    _ => 60, // free
                };
                if !rate_check(db, &k, limit) {
                    return Err(Response { status: 429, body: r#"{"error":"rate limit exceeded"}"#.into(), ..Default::default() });
                }
                Ok(Some(ak))
            }
            None => Err(Response { status: 401, body: r#"{"error":"invalid api key"}"#.into(), ..Default::default() }),
        }
    } else {
        // Anonymous — 10 req/min per IP
        let ip = extract_ip(req);
        if !rate_check(db, &ip, 10) {
            return Err(Response { status: 429, body: r#"{"error":"rate limit exceeded — get an API key for higher limits"}"#.into(), ..Default::default() });
        }
        Ok(None)
    }
}

fn db_upsert_job(db: &Db, job: &Job) {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO jobs
         (id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,duration_secs,progress,eta_secs,webhook_url,preset)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            job.id, format!("{:?}", job.status).to_lowercase(),
            format!("{:?}", job.media_kind).to_lowercase(),
            job.input_path, job.output_path,
            job.original_bytes as i64, job.compressed_bytes as i64,
            job.duration_secs, job.progress as i64, job.eta_secs as i64,
            job.webhook_url, job.preset
        ],
    ).ok();
}

fn db_get_job(db: &Db, id: &str) -> Option<Job> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,duration_secs,progress,eta_secs,webhook_url,preset FROM jobs WHERE id=?1",
        params![id],
        |row| {
            let status_str: String = row.get(1)?;
            let kind_str: String = row.get(2)?;
            Ok(Job {
                id: row.get(0)?,
                status: match status_str.as_str() {
                    "processing" => JobStatus::Processing,
                    "done" => JobStatus::Done,
                    "failed" => JobStatus::Failed,
                    _ => JobStatus::Queued,
                },
                media_kind: match kind_str.as_str() {
                    "audio_lossless" => MediaKind::AudioLossless,
                    "audio_lossy" => MediaKind::AudioLossy,
                    "image_animated" => MediaKind::ImageAnimated,
                    "image_static" => MediaKind::ImageStatic,
                    _ => MediaKind::Video,
                },
                input_path: row.get(3)?,
                output_path: row.get(4)?,
                original_bytes: row.get::<_, i64>(5)? as u64,
                compressed_bytes: row.get::<_, i64>(6)? as u64,
                duration_secs: row.get(7)?,
                progress: row.get::<_, i64>(8)? as u8,
                eta_secs: row.get::<_, i64>(9)? as u64,
                webhook_url: row.get(10)?,
                preset: row.get(11)?,
            })
        },
    ).ok()
}

// ── Preset profiles ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    WhatsApp,
    InstagramReel,
    Web,
    Twitter,
    Original,
}

fn preset_ffmpeg_args(preset: &Option<String>) -> Option<Vec<String>> {
    match preset.as_deref() {
        Some("whatsapp") => Some(vec![
            "-c:v", "libx264", "-preset", "fast", "-crf", "28",
            "-vf", "scale='min(1280,iw)':-2", "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
        ].into_iter().map(String::from).collect()),
        Some("instagram_reel") => Some(vec![
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        ].into_iter().map(String::from).collect()),
        Some("web") => Some(vec![
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-vf", "scale='min(1920,iw)':-2", "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
        ].into_iter().map(String::from).collect()),
        Some("twitter") => Some(vec![
            "-c:v", "libx264", "-preset", "fast", "-crf", "26",
            "-vf", "scale='min(1280,iw)':-2", "-c:a", "aac", "-b:a", "96k",
            "-t", "140", "-movflags", "+faststart",
        ].into_iter().map(String::from).collect()),
        _ => None,
    }
}

// ── Media type detection ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum MediaKind {
    Video,
    AudioLossless,
    AudioLossy,
    ImageAnimated,
    ImageStatic,
}

#[derive(Debug, Clone, Serialize)]
struct MediaProfile {
    kind: MediaKind,
    codec_name: String,
    duration_secs: f64,
    size_bytes: u64,
    width: Option<u64>,
    height: Option<u64>,
    #[serde(skip)]
    ffmpeg_args: Vec<String>,
    output_ext: String,        // default = input format
    available_formats: Vec<String>, // formats user can choose
    estimated_output_mb: f64,
    estimated_time_secs: u64,
}

async fn detect(path: &str) -> Result<MediaProfile, String> {
    let out = Command::new("ffprobe")
        // protocol_whitelist=file — even though `path` is validated to be a
        // real local file before this is called, this stops ffprobe itself
        // from following any http/concat/subfile/etc. reference the file's
        // *contents* might embed (e.g. a crafted playlist/manifest).
        .args(["-v", "quiet", "-protocol_whitelist", "file", "-print_format", "json", "-show_format", "-show_streams", path])
        .output().await.map_err(|e| e.to_string())?;

    let j: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let fmt = &j["format"];
    let size_bytes: u64 = fmt["size"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let duration_secs: f64 = fmt["duration"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
    let streams = j["streams"].as_array().ok_or("no streams")?;

    let video_stream = streams.iter().find(|s| s["codec_type"] == "video");
    let audio_stream = streams.iter().find(|s| s["codec_type"] == "audio");
    let width = video_stream.and_then(|v| v["width"].as_u64());
    let height = video_stream.and_then(|v| v["height"].as_u64());
    let video_codec = video_stream.and_then(|v| v["codec_name"].as_str()).unwrap_or("").to_string();
    let audio_codec = audio_stream.and_then(|a| a["codec_name"].as_str()).unwrap_or("").to_string();
    let nb_frames: u64 = video_stream
        .and_then(|v| v["nb_frames"].as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let size_mb = size_bytes as f64 / 1_048_576.0;

    // Derive default output ext from input filename
    let input_ext = std::path::Path::new(path)
        .extension().and_then(|e| e.to_str())
        .unwrap_or("mp4").to_lowercase();

    let is_animated_image = video_stream.is_some() && audio_stream.is_none()
        && (video_codec == "gif" || (duration_secs < 30.0 && nb_frames < 500 && video_codec == "webp"));
    if is_animated_image {
        let default_ext = if input_ext == "gif" { "gif" } else { "webp" };
        return Ok(MediaProfile {
            kind: MediaKind::ImageAnimated, codec_name: video_codec, duration_secs,
            size_bytes, width, height,
            ffmpeg_args: vec!["-c:v","libx264","-preset","fast","-crf","28","-an","-movflags","+faststart"].into_iter().map(String::from).collect(),
            output_ext: default_ext.into(),
            available_formats: vec!["gif".into(), "webp".into(), "mp4".into()],
            estimated_output_mb: size_mb * 0.15,
            estimated_time_secs: (duration_secs * 2.0) as u64 + 5,
        });
    }

    let is_static_image = video_stream.is_some() && audio_stream.is_none()
        && duration_secs < 0.1
        && matches!(video_codec.as_str(), "mjpeg"|"png"|"webp"|"tiff"|"bmp");
    if is_static_image {
        let default_ext = match video_codec.as_str() {
            "mjpeg" => "jpg", "png" => "png", "webp" => "webp", _ => "jpg"
        };
        return Ok(MediaProfile {
            kind: MediaKind::ImageStatic, codec_name: video_codec, duration_secs: 0.0,
            size_bytes, width, height,
            ffmpeg_args: vec!["-q:v","80"].into_iter().map(String::from).collect(),
            output_ext: default_ext.into(),
            available_formats: vec!["jpg".into(), "png".into(), "webp".into()],
            estimated_output_mb: size_mb * 0.30,
            estimated_time_secs: 2,
        });
    }

    if video_stream.is_some() {
        let default_ext = match input_ext.as_str() {
            "mp4"|"m4v"|"mov"|"mkv"|"avi"|"webm" => input_ext.as_str(),
            _ => "mp4"
        }.to_string();
        return Ok(MediaProfile {
            kind: MediaKind::Video, codec_name: video_codec, duration_secs,
            size_bytes, width, height,
            ffmpeg_args: vec!["-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart"].into_iter().map(String::from).collect(),
            output_ext: default_ext,
            available_formats: vec!["mp4".into(), "mov".into(), "mkv".into(), "webm".into(), "avi".into()],
            estimated_output_mb: size_mb * 0.15,
            estimated_time_secs: (duration_secs * 0.8) as u64 + 5,
        });
    }

    if matches!(audio_codec.as_str(), "flac"|"pcm_s16le"|"pcm_s24le"|"pcm_f32le"|"aiff") {
        let default_ext = match input_ext.as_str() {
            "flac"|"wav"|"aiff"|"aif" => input_ext.as_str(), _ => "flac"
        }.to_string();
        return Ok(MediaProfile {
            kind: MediaKind::AudioLossless, codec_name: audio_codec, duration_secs,
            size_bytes, width: None, height: None,
            ffmpeg_args: vec!["-c:a","aac","-b:a","192k","-vn"].into_iter().map(String::from).collect(),
            output_ext: default_ext,
            available_formats: vec!["mp3".into(), "m4a".into(), "ogg".into(), "flac".into(), "wav".into()],
            estimated_output_mb: duration_secs * 192.0 / 8.0 / 1024.0,
            estimated_time_secs: (duration_secs * 0.3) as u64 + 2,
        });
    }

    if audio_stream.is_some() {
        let default_ext = match input_ext.as_str() {
            "mp3"|"m4a"|"ogg"|"aac"|"opus" => input_ext.as_str(), _ => "mp3"
        }.to_string();
        return Ok(MediaProfile {
            kind: MediaKind::AudioLossy, codec_name: audio_codec, duration_secs,
            size_bytes, width: None, height: None,
            ffmpeg_args: vec!["-c:a","aac","-b:a","128k","-vn"].into_iter().map(String::from).collect(),
            output_ext: default_ext,
            available_formats: vec!["mp3".into(), "m4a".into(), "ogg".into(), "aac".into()],
            estimated_output_mb: duration_secs * 128.0 / 8.0 / 1024.0,
            estimated_time_secs: (duration_secs * 0.2) as u64 + 2,
        });
    }

    Err("unsupported media type".into())
}

// ── Job types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum JobStatus { Queued, Processing, Done, Failed }

#[derive(Debug, Clone, Serialize)]
struct Job {
    id: String,
    status: JobStatus,
    media_kind: MediaKind,
    input_path: String,
    output_path: String,
    original_bytes: u64,
    compressed_bytes: u64,
    duration_secs: f64,
    progress: u8,
    eta_secs: u64,
    webhook_url: Option<String>,
    preset: Option<String>,
}

type JobStore = Arc<Mutex<HashMap<String, Job>>>;

#[derive(Clone)]
struct AppState {
    jobs: JobStore,
    db: Db,
}

fn format_ffmpeg_args(kind: &MediaKind, fmt: &str) -> Vec<String> {
    let s = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    match (kind, fmt) {
        // Video formats
        (MediaKind::Video | MediaKind::ImageAnimated, "mp4" | "mov" | "m4v") =>
            s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "mkv") =>
            s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "webm") =>
            s(&["-c:v","libvpx-vp9","-crf","33","-b:v","0","-c:a","libopus","-b:a","128k"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "avi") =>
            s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","mp3","-b:a","128k"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "gif") =>
            s(&["-vf","fps=15,scale='min(480,iw)':-1:flags=lanczos","-loop","0"]),
        // Audio formats
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "mp3") =>
            s(&["-c:a","libmp3lame","-b:a","192k","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "m4a") =>
            s(&["-c:a","aac","-b:a","192k","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "ogg") =>
            s(&["-c:a","libvorbis","-q:a","6","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "flac") =>
            s(&["-c:a","flac","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "wav") =>
            s(&["-c:a","pcm_s16le","-vn"]),
        // Images
        (MediaKind::ImageStatic, "jpg") => s(&["-q:v","85"]),
        (MediaKind::ImageStatic, "png") => s(&["-compression_level","6"]),
        (MediaKind::ImageStatic, "webp") => s(&["-q:v","80"]),
        // Fallback — keep original args
        _ => vec![],
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /ingest — raw bytes, x-file-name header → { path }
#[post("/ingest")]
async fn ingest(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let name = req.headers.get("x-file-name")
        .cloned()
        .unwrap_or_else(|| "upload.bin".into());
    let name = std::path::Path::new(&name)
        .file_name().and_then(|n| n.to_str()).unwrap_or("upload.bin").to_string();
    // UUID prefix prevents filename collision (B1 fix)
    let uid = Uuid::new_v4().to_string()[..8].to_string();
    let path = format!("{INGEST_DIR}/{INGEST_PREFIX}{uid}_{name}");
    if let Err(e) = tokio::fs::write(&path, &req.body).await {
        return Response { status: 500, body: format!(r#"{{"error":"{e}"}}"#) , ..Default::default() };
    }
    // Remux .mov/.avi/.mkv → .mp4 for universal browser/Cloudflare compatibility
    let path = remux_to_mp4_if_needed(&path).await;
    Response { status: 200, body: format!(r#"{{"path":"{path}"}}"#) , ..Default::default() }
}

/// POST /analyze — { path } → MediaProfile
#[post("/analyze")]
async fn analyze(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let path = match extract_path(&req) { Ok(p) => p, Err(r) => return r };
    match detect(&path).await {
        Ok(profile) => Response { status: 200, body: serde_json::to_string(&profile).unwrap(), ..Default::default() },
        Err(e) => Response { status: 415, body: format!(r#"{{"error":"{e}"}}"#), ..Default::default() },
    }
}

/// POST /upload — { path, webhook_url?, preset? } → { job_id, status, estimated_time_secs }
#[post("/upload")]
async fn upload(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };
    let raw_path = match body["path"].as_str() {
        Some(p) => p.to_string(),
        None => return Response { status: 400, body: r#"{"error":"missing path"}"#.into(), ..Default::default() },
    };
    let path = match validate_ingest_path(&raw_path) { Ok(p) => p, Err(r) => return r };
    let webhook_url = body["webhook_url"].as_str().map(String::from);
    if let Some(ref wh) = webhook_url {
        if let Err(e) = validate_outbound_url(wh).await {
            return Response { status: 400, body: format!(r#"{{"error":"invalid webhook_url: {e}"}}"#), ..Default::default() };
        }
    }
    let preset = body["preset"].as_str().map(String::from);
    let output_format = body["output_format"].as_str().map(String::from);

    let mut profile = match detect(&path).await {
        Ok(p) => p,
        Err(e) => return Response { status: 415, body: format!(r#"{{"error":"{e}"}}"#), ..Default::default() },
    };
    // Override output format if user specified one
    if let Some(ref fmt) = output_format {
        profile.output_ext = fmt.clone();
        // Adjust ffmpeg args for format-specific containers
        profile.ffmpeg_args = format_ffmpeg_args(&profile.kind, fmt);
    }

    let id = Uuid::new_v4().to_string();
    // Persistent storage dir (B2 fix)
    let out_dir = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let output_path = format!("{}/{}_output.{}", out_dir, id, profile.output_ext);
    let eta = profile.estimated_time_secs;

    let job = Job {
        id: id.clone(), status: JobStatus::Queued,
        media_kind: profile.kind.clone(),
        input_path: path.clone(), output_path: output_path.clone(),
        original_bytes: profile.size_bytes, compressed_bytes: 0,
        duration_secs: profile.duration_secs, progress: 0, eta_secs: eta,
        webhook_url: webhook_url.clone(), preset: preset.clone(),
    };

    db_upsert_job(&state.db, &job);
    state.jobs.lock().unwrap().insert(id.clone(), job);

    let jobs = state.jobs.clone();
    let db = state.db.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        compress(id_clone, path, output_path, profile, preset, jobs, db).await;
    });

    Response {
        status: 202,
        body: format!(r#"{{"job_id":"{id}","status":"queued","estimated_time_secs":{eta}}}"#),
        ..Default::default()
    }
}

/// GET /jobs/:id
#[get("/jobs/:id")]
async fn get_job(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id = req.params.get("id").cloned().unwrap_or_default();
    // Check in-memory first, fall back to DB (survives restart)
    let job = state.jobs.lock().unwrap().get(&id).cloned()
        .or_else(|| db_get_job(&state.db, &id));
    match job {
        Some(j) => Response { status: 200, body: serde_json::to_string(&j).unwrap(), ..Default::default() },
        None => Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    }
}

/// Guess a Content-Type for a job's output file from its extension.
fn content_type_for(output_path: &str) -> &'static str {
    match std::path::Path::new(output_path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "gif" => "image/gif",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// GET /download/:id — streams compressed file
#[get("/download/:id")]
async fn download(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id = req.params.get("id").cloned().unwrap_or_default();
    let job = state.jobs.lock().unwrap().get(&id).cloned()
        .or_else(|| db_get_job(&state.db, &id));
    match job {
        Some(j) if matches!(j.status, JobStatus::Done) => {
            match std::fs::read(&j.output_path) {
                // Raw bytes, not routed through String — String::from_utf8_lossy
                // here would silently corrupt any binary output (see glideapi#1).
                Ok(bytes) => Response::binary(200, bytes, content_type_for(&j.output_path)),
                Err(_) => Response { status: 404, body: r#"{"error":"output file missing"}"#.into(), ..Default::default() },
            }
        }
        Some(_) => Response { status: 409, body: r#"{"error":"job not done yet"}"#.into(), ..Default::default() },
        None => Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    }
}

/// GET /health
#[get("/health")]
async fn health(_req: Request) -> Response {
    Response { status: 200, body: r#"{"ok":true}"#.into(), ..Default::default() }
}

/// POST /keys — create API key { name, plan, webhook_url?, white_label_domain?, white_label_brand? }
#[post("/keys")]
async fn create_key(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    // Anonymous by definition (a key doesn't exist yet) — still rate-limited
    // per IP so this can't be used to flood api_keys.
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v, Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };
    let name = body["name"].as_str().unwrap_or("unnamed").to_string();
    // Self-serve key creation only ever issues the free plan — there is no
    // payment verification here, so trusting a client-supplied `plan` (as
    // this used to do) let anyone mint a "premium"/"api_scale"/"whitelabel"
    // key for free. Paid plans must be granted out of band (e.g. an admin
    // action after a Stripe webhook confirms payment) by updating the row
    // directly, not through this endpoint.
    let plan = "free";
    let webhook_url = body["webhook_url"].as_str().map(String::from);
    if let Some(ref wh) = webhook_url {
        if let Err(e) = validate_outbound_url(wh).await {
            return Response { status: 400, body: format!(r#"{{"error":"invalid webhook_url: {e}"}}"#), ..Default::default() };
        }
    }
    let wl_domain = body["white_label_domain"].as_str().map(String::from);
    let wl_brand = body["white_label_brand"].as_str().map(String::from);

    // Enforce white-label domain uniqueness
    if let Some(ref domain) = wl_domain {
        let conn = state.db.lock().unwrap();
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM api_keys WHERE white_label_domain=?1",
            params![domain], |r| r.get::<_, i64>(0)
        ).unwrap_or(0) > 0;
        if exists {
            return Response { status: 409, body: r#"{"error":"white-label domain already taken"}"#.into(), ..Default::default() };
        }
    }

    let key = generate_api_key();
    {
        let conn = state.db.lock().unwrap();
        conn.execute(
            "INSERT INTO api_keys(key,name,plan,webhook_url,white_label_domain,white_label_brand) VALUES(?1,?2,?3,?4,?5,?6)",
            params![key, name, plan, webhook_url, wl_domain, wl_brand]
        ).ok();
    }
    Response { status: 201, body: serde_json::json!({ "key": key, "name": name, "plan": plan }).to_string() , ..Default::default() }
}

/// POST /download-url — { url, audio_only?, output_format? } — download from YouTube/IG/X/TikTok
#[post("/download-url")]
async fn download_url(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v, Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };
    let url = match body["url"].as_str() {
        Some(u) => u.to_string(),
        None => return Response { status: 400, body: r#"{"error":"missing url"}"#.into(), ..Default::default() },
    };
    if let Err(e) = validate_outbound_url(&url).await {
        return Response { status: 400, body: format!(r#"{{"error":"invalid url: {e}"}}"#), ..Default::default() };
    }
    let audio_only = body["audio_only"].as_bool().unwrap_or(false);
    let webhook_url = body["webhook_url"].as_str().map(String::from);
    if let Some(ref wh) = webhook_url {
        if let Err(e) = validate_outbound_url(wh).await {
            return Response { status: 400, body: format!(r#"{{"error":"invalid webhook_url: {e}"}}"#), ..Default::default() };
        }
    }

    let id = Uuid::new_v4().to_string();
    let out_dir = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let ext = if audio_only { "mp3" } else { "mp4" };
    let output_path = format!("{}/{}_dl.{}", out_dir, id, ext);

    let job = Job {
        id: id.clone(), status: JobStatus::Queued,
        media_kind: if audio_only { MediaKind::AudioLossy } else { MediaKind::Video },
        input_path: url.clone(), output_path: output_path.clone(),
        original_bytes: 0, compressed_bytes: 0, duration_secs: 0.0,
        progress: 0, eta_secs: 60, webhook_url: webhook_url.clone(), preset: None,
    };
    db_upsert_job(&state.db, &job);
    state.jobs.lock().unwrap().insert(id.clone(), job);

    let jobs = state.jobs.clone();
    let db = state.db.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        run_yt_dlp(id_clone, url, output_path, audio_only, jobs, db).await;
    });

    Response { status: 202, body: serde_json::json!({ "job_id": id, "status": "queued" }).to_string() , ..Default::default() }
}

/// POST /transcribe — { job_id } or { path } — transcribe audio/video
#[post("/transcribe")]
async fn transcribe(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };
    let is_premium = caller.as_ref().map(|k| k.plan == "premium").unwrap_or(false);
    let model = if is_premium { "medium" } else { "base" };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v, Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };

    let path = if let Some(jid) = body["job_id"].as_str() {
        let job = state.jobs.lock().unwrap().get(jid).cloned()
            .or_else(|| db_get_job(&state.db, jid));
        match job {
            Some(j) if matches!(j.status, JobStatus::Done) => j.output_path,
            Some(_) => return Response { status: 409, body: r#"{"error":"job not done yet"}"#.into(), ..Default::default() },
            None => return Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
        }
    } else if let Some(p) = body["path"].as_str() {
        match validate_ingest_path(p) { Ok(v) => v, Err(r) => return r }
    } else {
        return Response { status: 400, body: r#"{"error":"provide job_id or path"}"#.into(), ..Default::default() };
    };

    let tid = Uuid::new_v4().to_string();
    let out_dir = storage_dir();
    let out_file = format!("{}/{}_transcript.json", out_dir, tid);

    let result = Command::new("whisper")
        .args([&path, "--model", model, "--output_format", "json",
               "--output_dir", &out_dir, "--language", "auto"])
        .output().await;

    match result {
        Ok(o) if o.status.success() => {
            let stem = std::path::Path::new(&path)
                .file_stem().and_then(|s| s.to_str()).unwrap_or("output");
            let whisper_out = format!("{}/{}.json", out_dir, stem);
            let text = tokio::fs::read_to_string(&whisper_out).await
                .unwrap_or_else(|_| String::from_utf8_lossy(&o.stdout).into_owned());
            {
                let conn = state.db.lock().unwrap();
                conn.execute(
                    "INSERT INTO transcriptions(id,job_id,text) VALUES(?1,?2,?3)",
                    params![tid, body["job_id"].as_str().unwrap_or(""), text]
                ).ok();
            }
            let _ = tokio::fs::rename(&whisper_out, &out_file).await;
            Response { status: 200, body: serde_json::json!({ "id": tid, "text": text, "model": model }).to_string() , ..Default::default() }
        }
        _ => Response { status: 500, body: r#"{"error":"transcription failed"}"#.into(), ..Default::default() },
    }
}

/// GET /transcriptions/:id
#[get("/transcriptions/:id")]
async fn get_transcription(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id = req.params.get("id").cloned().unwrap_or_default();
    let conn = state.db.lock().unwrap();
    let result = conn.query_row(
        "SELECT id,job_id,text,language FROM transcriptions WHERE id=?1",
        params![id],
        |r| Ok(serde_json::json!({ "id": r.get::<_,String>(0)?, "job_id": r.get::<_,String>(1)?, "text": r.get::<_,String>(2)? }))
    );
    match result {
        Ok(v) => Response { status: 200, body: v.to_string(), ..Default::default() },
        Err(_) => Response { status: 404, body: r#"{"error":"not found"}"#.into(), ..Default::default() },
    }
}

// ── yt-dlp download ───────────────────────────────────────────────────────────

async fn run_yt_dlp(id: String, url: String, output: String, audio_only: bool, jobs: JobStore, db: Db) {
    set_status(&jobs, &id, JobStatus::Processing);
    db_upsert_job(&db, &jobs.lock().unwrap().get(&id).unwrap().clone());

    let mut args = vec![
        "--no-playlist".to_string(),
        "-o".to_string(), output.clone(),
    ];
    if audio_only {
        args.extend(["--extract-audio".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "0".into()]);
    } else {
        args.extend(["-f".into(), "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".into()]);
    }
    args.push(url);

    let result = Command::new("yt-dlp").args(&args).output().await;
    match result {
        Ok(o) if o.status.success() => {
            let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
            let mut store = jobs.lock().unwrap();
            if let Some(job) = store.get_mut(&id) {
                job.status = JobStatus::Done;
                job.compressed_bytes = size;
                job.original_bytes = size;
                job.progress = 100;
                let job_clone = job.clone();
                drop(store);
                db_upsert_job(&db, &job_clone);
                let wh = job_clone.webhook_url.clone();
                let payload = serde_json::to_string(&job_clone).unwrap_or_default();
                if let Some(url) = wh {
                    tokio::spawn(async move { deliver_webhook(&url, &payload).await; });
                }
            }
        }
        Ok(o) => {
            tracing::error!("yt-dlp failed: {}", String::from_utf8_lossy(&o.stderr));
            set_status(&jobs, &id, JobStatus::Failed);
            db_upsert_job(&db, &jobs.lock().unwrap().get(&id).unwrap().clone());
        }
        Err(e) => {
            tracing::error!("yt-dlp spawn failed: {e}");
            set_status(&jobs, &id, JobStatus::Failed);
        }
    }
}

// ── Remux .mov → .mp4 (fixes MIME issues on browsers/Cloudflare) ─────────────

async fn remux_to_mp4_if_needed(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "mov" && ext != "avi" && ext != "mkv" { return path.to_string(); }
    let out = format!("{}.mp4", &path[..path.len() - ext.len() - 1]);
    let result = Command::new("ffmpeg")
        .args(["-y", "-protocol_whitelist", "file", "-i", path, "-c", "copy", "-movflags", "+faststart", &out])
        .output().await;
    match result {
        Ok(o) if o.status.success() => { let _ = tokio::fs::remove_file(path).await; out }
        _ => path.to_string(),
    }
}

// ── Compression ───────────────────────────────────────────────────────────────

async fn compress(
    id: String, input: String, output: String,
    profile: MediaProfile, preset: Option<String>,
    jobs: JobStore, db: Db,
) {
    let update = |status: JobStatus, progress: u8, eta: u64, compressed: u64| {
        let mut store = jobs.lock().unwrap();
        if let Some(job) = store.get_mut(&id) {
            job.status = status.clone();
            job.progress = progress;
            job.eta_secs = eta;
            job.compressed_bytes = compressed;
        }
        // persist to DB
        if let Some(job) = store.get(&id).cloned() {
            drop(store);
            db_upsert_job(&db, &job);
        }
    };

    update(JobStatus::Processing, 0, profile.estimated_time_secs, 0);

    let progress_file = format!("/tmp/{id}_progress");
    let duration = profile.duration_secs;

    // Preset overrides default ffmpeg args
    let ffmpeg_args = preset_ffmpeg_args(&preset).unwrap_or(profile.ffmpeg_args.clone());

    let mut args: Vec<String> = vec!["-y".into(), "-protocol_whitelist".into(), "file".into(), "-i".into(), input.clone()];
    args.extend(ffmpeg_args);
    if duration > 0.1 {
        args.extend(["-progress".into(), progress_file.clone(), "-nostats".into()]);
    }
    args.push(output.clone());

    let mut child = match Command::new("ffmpeg").args(&args)
        .stderr(std::process::Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("ffmpeg spawn failed: {e}");
            update(JobStatus::Failed, 0, 0, 0);
            return;
        }
    };

    // Progress polling
    let jobs_p = jobs.clone();
    let db_p = db.clone();
    let id_p = id.clone();
    let pf = progress_file.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(content) = tokio::fs::read_to_string(&pf).await {
                if let Some(us) = parse_us(&content) {
                    let elapsed = us as f64 / 1_000_000.0;
                    let pct = ((elapsed / duration) * 100.0).min(99.0) as u8;
                    let eta = if pct > 0 { ((elapsed / (pct as f64 / 100.0)) - elapsed) as u64 } else { 0 };
                    let mut s = jobs_p.lock().unwrap();
                    if let Some(job) = s.get_mut(&id_p) {
                        job.progress = pct;
                        job.eta_secs = eta;
                        let job_clone = job.clone();
                        drop(s);
                        db_upsert_job(&db_p, &job_clone);
                    }
                }
            }
        }
    });

    let result = child.wait_with_output().await;
    progress_task.abort();
    let _ = tokio::fs::remove_file(&progress_file).await;

    match result {
        Ok(out) if out.status.success() => {
            let compressed_bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
            {
                let mut store = jobs.lock().unwrap();
                if let Some(job) = store.get_mut(&id) {
                    job.status = JobStatus::Done;
                    job.compressed_bytes = compressed_bytes;
                    job.progress = 100;
                    job.eta_secs = 0;
                    let job_clone = job.clone();
                    drop(store);
                    db_upsert_job(&db, &job_clone);
                    // Fire webhook
                    let webhook = job_clone.webhook_url.clone();
                    let payload = serde_json::to_string(&job_clone).unwrap_or_default();
                    if let Some(url) = webhook {
                        tokio::spawn(async move {
                            deliver_webhook(&url, &payload).await;
                        });
                    }
                }
            }
        }
        _ => {
            if let Ok(ref out) = result {
                tracing::error!("ffmpeg failed:\n{}", String::from_utf8_lossy(&out.stderr));
            }
            update(JobStatus::Failed, 0, 0, 0);
        }
    }
}

// ── Webhook delivery ──────────────────────────────────────────────────────────

async fn deliver_webhook(url: &str, payload: &str) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();
    for attempt in 0..3u32 {
        match client.post(url)
            .header("content-type", "application/json")
            .header("x-vidpress-event", "job.done")
            .body(payload.to_string())
            .send().await
        {
            Ok(r) if r.status().is_success() => {
                tracing::info!("webhook delivered to {url} on attempt {attempt}");
                return;
            }
            Ok(r) => tracing::warn!("webhook {url} returned {}", r.status()),
            Err(e) => tracing::warn!("webhook {url} failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
    }
    tracing::error!("webhook {url} failed after 3 attempts");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn set_status(jobs: &JobStore, id: &str, status: JobStatus) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.status = status;
    }
}

fn parse_us(content: &str) -> Option<u64> {
    content.lines()
        .filter_map(|l| l.strip_prefix("out_time_us="))
        .last()
        .and_then(|v| v.trim().parse().ok())
}

fn extract_path(req: &Request) -> Result<String, Response> {
    let body: serde_json::Value = serde_json::from_slice(&req.body)
        .map_err(|_| Response { status: 400, body: r#"{"error":"expected JSON with 'path' field"}"#.into(), ..Default::default() })?;
    let raw = body["path"].as_str()
        .ok_or_else(|| Response { status: 400, body: r#"{"error":"missing 'path' field"}"#.into(), ..Default::default() })?;
    validate_ingest_path(raw)
}

#[cfg(test)]
mod tests {
    use super::{content_type_for, is_disallowed_ip, validate_ingest_path, validate_outbound_url, INGEST_DIR, INGEST_PREFIX};

    #[test]
    fn validate_ingest_path_accepts_real_ingest_file() {
        let path = format!("{INGEST_DIR}/{INGEST_PREFIX}test_accept.bin");
        std::fs::write(&path, b"hi").unwrap();
        let result = validate_ingest_path(&path);
        std::fs::remove_file(&path).ok();
        assert!(result.is_ok(), "expected a real ingest-prefixed file under INGEST_DIR to be accepted");
    }

    #[test]
    fn validate_ingest_path_rejects_files_outside_ingest_dir() {
        // A real file that exists, but not under INGEST_DIR/with the ingest prefix.
        assert!(validate_ingest_path("/etc/hostname").is_err());
    }

    #[test]
    fn validate_ingest_path_rejects_wrong_filename_prefix_even_inside_ingest_dir() {
        let path = format!("{INGEST_DIR}/not_our_prefix_test.bin");
        std::fs::write(&path, b"hi").unwrap();
        let result = validate_ingest_path(&path);
        std::fs::remove_file(&path).ok();
        assert!(result.is_err(), "a file under INGEST_DIR without our prefix must not be treated as ours");
    }

    #[test]
    fn validate_ingest_path_rejects_nonexistent_or_protocol_strings() {
        assert!(validate_ingest_path("http://169.254.169.254/latest/meta-data/").is_err());
        assert!(validate_ingest_path("concat:/etc/passwd|/etc/shadow").is_err());
        assert!(validate_ingest_path(&format!("{INGEST_DIR}/{INGEST_PREFIX}does_not_exist.bin")).is_err());
    }

    #[test]
    fn is_disallowed_ip_blocks_loopback_private_and_link_local() {
        assert!(is_disallowed_ip(&"127.0.0.1".parse().unwrap()));
        assert!(is_disallowed_ip(&"169.254.169.254".parse().unwrap())); // cloud metadata
        assert!(is_disallowed_ip(&"10.0.0.5".parse().unwrap()));
        assert!(is_disallowed_ip(&"192.168.1.1".parse().unwrap()));
        assert!(is_disallowed_ip(&"::1".parse().unwrap()));
        assert!(!is_disallowed_ip(&"8.8.8.8".parse().unwrap()));
    }

    #[tokio::test]
    async fn validate_outbound_url_rejects_non_http_schemes_and_loopback() {
        assert!(validate_outbound_url("file:///etc/passwd").await.is_err());
        assert!(validate_outbound_url("ftp://example.com/x").await.is_err());
        assert!(validate_outbound_url("http://127.0.0.1/admin").await.is_err());
        assert!(validate_outbound_url("http://169.254.169.254/latest/meta-data/").await.is_err());
        assert!(validate_outbound_url("not a url at all").await.is_err());
    }

    #[test]
    fn content_type_matches_extension() {
        assert_eq!(content_type_for("/tmp/x_output.mp4"), "video/mp4");
        assert_eq!(content_type_for("/tmp/x_output.mkv"), "video/x-matroska");
        assert_eq!(content_type_for("/tmp/x_output.mp3"), "audio/mpeg");
        assert_eq!(content_type_for("/tmp/x_output.flac"), "audio/flac");
        assert_eq!(content_type_for("/tmp/x_output.png"), "image/png");
        assert_eq!(content_type_for("/tmp/x_output.unknownext"), "application/octet-stream");
        assert_eq!(content_type_for("/tmp/no_extension"), "application/octet-stream");
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let conn = Connection::open(db_path()).expect("cannot open db");
    init_db(&conn);

    // Reload in-progress jobs from DB into memory on startup
    let mut jobs_map: HashMap<String, Job> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,duration_secs,progress,eta_secs,webhook_url,preset FROM jobs"
        ).unwrap();
        let rows = stmt.query_map([], |row| {
            let status_str: String = row.get(1)?;
            let kind_str: String = row.get(2)?;
            Ok(Job {
                id: row.get(0)?,
                status: match status_str.as_str() {
                    "processing" => JobStatus::Failed, // mark stale processing as failed
                    "done" => JobStatus::Done,
                    "failed" => JobStatus::Failed,
                    _ => JobStatus::Queued,
                },
                media_kind: match kind_str.as_str() {
                    "audio_lossless" => MediaKind::AudioLossless,
                    "audio_lossy" => MediaKind::AudioLossy,
                    "image_animated" => MediaKind::ImageAnimated,
                    "image_static" => MediaKind::ImageStatic,
                    _ => MediaKind::Video,
                },
                input_path: row.get(3)?,
                output_path: row.get(4)?,
                original_bytes: row.get::<_, i64>(5)? as u64,
                compressed_bytes: row.get::<_, i64>(6)? as u64,
                duration_secs: row.get(7)?,
                progress: row.get::<_, i64>(8)? as u8,
                eta_secs: row.get::<_, i64>(9)? as u64,
                webhook_url: row.get(10)?,
                preset: row.get(11)?,
            })
        }).unwrap();
        for row in rows.flatten() {
            jobs_map.insert(row.id.clone(), row);
        }
    }

    let db: Db = Arc::new(Mutex::new(conn));
    let state = AppState {
        jobs: Arc::new(Mutex::new(jobs_map)),
        db,
    };

    App::new()
        .config(Config {
            body_limit: 2 * 1024 * 1024 * 1024,
            request_timeout: Duration::from_secs(600),
            cors_origin: Some("*".into()),
        })
        .state(state)
        .mount_routes()
        .listen("0.0.0.0:8080")
        .await;
}
