use glideapi::{App, Config, FromRequest, Request, Response, State};
use glideapi_macros::{get, post};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::process::Command;
use uuid::Uuid;

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
    /// ffmpeg args (excluding -i input and output path)
    #[serde(skip)]
    ffmpeg_args: Vec<String>,
    output_ext: String,
    estimated_output_mb: f64,
    estimated_time_secs: u64,
}

async fn detect(path: &str) -> Result<MediaProfile, String> {
    let out = Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json",
               "-show_format", "-show_streams", path])
        .output().await.map_err(|e| e.to_string())?;

    let j: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| e.to_string())?;

    let fmt = &j["format"];
    let size_bytes: u64 = fmt["size"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let duration_secs: f64 = fmt["duration"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
    let streams = j["streams"].as_array().ok_or("no streams")?;

    let video_stream = streams.iter().find(|s| s["codec_type"] == "video");
    let audio_stream = streams.iter().find(|s| s["codec_type"] == "audio");

    let width  = video_stream.and_then(|v| v["width"].as_u64());
    let height = video_stream.and_then(|v| v["height"].as_u64());
    let video_codec = video_stream.and_then(|v| v["codec_name"].as_str()).unwrap_or("").to_string();
    let audio_codec = audio_stream.and_then(|a| a["codec_name"].as_str()).unwrap_or("").to_string();
    let nb_frames: u64 = video_stream
        .and_then(|v| v["nb_frames"].as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let size_mb = size_bytes as f64 / 1_048_576.0;

    // ── Routing logic ─────────────────────────────────────────────────────────

    // Animated image (gif / animated webp) — has video stream, very short or no audio
    let is_animated_image = video_stream.is_some()
        && audio_stream.is_none()
        && (video_codec == "gif" || (duration_secs < 30.0 && nb_frames < 500 && video_codec == "webp"));

    if is_animated_image {
        return Ok(MediaProfile {
            kind: MediaKind::ImageAnimated,
            codec_name: video_codec,
            duration_secs,
            size_bytes,
            width,
            height,
            ffmpeg_args: vec![
                "-c:v", "libx265", "-preset", "ultrafast", "-crf", "28", "-an",
            ].into_iter().map(String::from).collect(),
            output_ext: "mp4".into(),
            estimated_output_mb: size_mb * 0.15,
            estimated_time_secs: (duration_secs * 2.0) as u64 + 5,
        });
    }

    // Static image — has video stream, duration ~0, no audio
    let is_static_image = video_stream.is_some()
        && audio_stream.is_none()
        && duration_secs < 0.1
        && matches!(video_codec.as_str(), "mjpeg" | "png" | "webp" | "tiff" | "bmp");

    if is_static_image {
        return Ok(MediaProfile {
            kind: MediaKind::ImageStatic,
            codec_name: video_codec,
            duration_secs: 0.0,
            size_bytes,
            width,
            height,
            ffmpeg_args: vec!["-q:v", "80"].into_iter().map(String::from).collect(),
            output_ext: "webp".into(),
            estimated_output_mb: size_mb * 0.30,
            estimated_time_secs: 2,
        });
    }

    // Video (has video stream + optional audio)
    if video_stream.is_some() {
        return Ok(MediaProfile {
            kind: MediaKind::Video,
            codec_name: video_codec,
            duration_secs,
            size_bytes,
            width,
            height,
            ffmpeg_args: vec![
                "-c:v", "libx265", "-preset", "ultrafast", "-crf", "24",
                "-c:a", "aac", "-b:a", "128k",
            ].into_iter().map(String::from).collect(),
            output_ext: "mp4".into(),
            estimated_output_mb: size_mb * 0.10,
            estimated_time_secs: (duration_secs * 1.5) as u64,
        });
    }

    // Lossless audio
    if matches!(audio_codec.as_str(), "flac" | "pcm_s16le" | "pcm_s24le" | "pcm_f32le" | "aiff") {
        return Ok(MediaProfile {
            kind: MediaKind::AudioLossless,
            codec_name: audio_codec,
            duration_secs,
            size_bytes,
            width: None,
            height: None,
            ffmpeg_args: vec!["-c:a", "aac", "-b:a", "192k", "-vn"]
                .into_iter().map(String::from).collect(),
            output_ext: "m4a".into(),
            estimated_output_mb: (duration_secs * 192.0 / 8.0 / 1024.0),
            estimated_time_secs: (duration_secs * 0.3) as u64 + 2,
        });
    }

    // Lossy audio
    if audio_stream.is_some() {
        return Ok(MediaProfile {
            kind: MediaKind::AudioLossy,
            codec_name: audio_codec,
            duration_secs,
            size_bytes,
            width: None,
            height: None,
            ffmpeg_args: vec!["-c:a", "aac", "-b:a", "128k", "-vn"]
                .into_iter().map(String::from).collect(),
            output_ext: "m4a".into(),
            estimated_output_mb: (duration_secs * 128.0 / 8.0 / 1024.0),
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
}

type JobStore = Arc<Mutex<HashMap<String, Job>>>;

#[derive(Clone)]
struct AppState { jobs: JobStore }

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /analyze — { "path": "..." } — returns media profile + estimates
#[post("/analyze")]
async fn analyze(req: Request) -> Response {
    let path = match extract_path(&req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    match detect(&path).await {
        Ok(profile) => Response { status: 200, body: serde_json::to_string(&profile).unwrap() },
        Err(e) => Response { status: 415, body: format!(r#"{{"error":"{e}"}}"#) },
    }
}

/// POST /upload — { "path": "..." } — queues compression job
#[post("/upload")]
async fn upload(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let path = match extract_path(&req) {
        Ok(p) => p,
        Err(r) => return r,
    };

    let profile = match detect(&path).await {
        Ok(p) => p,
        Err(e) => return Response { status: 415, body: format!(r#"{{"error":"{e}"}}"#) },
    };

    let id = Uuid::new_v4().to_string();
    let output_path = format!("/tmp/{id}_output.{}", profile.output_ext);

    let job = Job {
        id: id.clone(),
        status: JobStatus::Queued,
        media_kind: profile.kind.clone(),
        input_path: path.clone(),
        output_path: output_path.clone(),
        original_bytes: profile.size_bytes,
        compressed_bytes: 0,
        duration_secs: profile.duration_secs,
        progress: 0,
        eta_secs: profile.estimated_time_secs,
    };

    state.jobs.lock().unwrap().insert(id.clone(), job);

    let jobs = state.jobs.clone();
    let id_clone = id.clone();
    let eta = profile.estimated_time_secs;
    tokio::spawn(async move {
        compress(id_clone, path, output_path, profile, jobs).await;
    });

    Response {
        status: 202,
        body: format!(r#"{{"job_id":"{id}","status":"queued","estimated_time_secs":{eta}}}"#),
    }
}

/// GET /jobs/:id
#[get("/jobs/:id")]
async fn get_job(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let id = req.params.get("id").cloned().unwrap_or_default();
    let result = state.jobs.lock().unwrap().get(&id)
        .map(|j| (200u16, serde_json::to_string(j).unwrap()))
        .unwrap_or_else(|| (404, r#"{"error":"job not found"}"#.into()));
    Response { status: result.0, body: result.1 }
}

/// GET /health
#[get("/health")]
async fn health(_req: Request) -> Response {
    Response { status: 200, body: r#"{"ok":true}"#.into() }
}

// ── Compression ───────────────────────────────────────────────────────────────

async fn compress(id: String, input: String, output: String, profile: MediaProfile, jobs: JobStore) {
    set_status(&jobs, &id, JobStatus::Processing);

    let progress_file = format!("/tmp/{id}_progress");
    let duration = profile.duration_secs;

    let mut args: Vec<String> = vec![
        "-y".into(), "-i".into(), input.clone(),
    ];
    args.extend(profile.ffmpeg_args);

    // Progress tracking only meaningful for time-based media
    if duration > 0.1 {
        args.extend(["-progress".into(), progress_file.clone(), "-nostats".into()]);
    }
    args.push(output.clone());

    let mut child = match Command::new("ffmpeg").args(&args).spawn() {
        Ok(c) => c,
        Err(_) => { set_status(&jobs, &id, JobStatus::Failed); return; }
    };

    // Progress polling task
    let jobs_p = jobs.clone();
    let id_p = id.clone();
    let pf = progress_file.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(content) = tokio::fs::read_to_string(&pf).await {
                if let Some(us) = parse_us(&content) {
                    let elapsed = us as f64 / 1_000_000.0;
                    let pct = ((elapsed / duration) * 100.0).min(99.0) as u8;
                    let eta = if pct > 0 {
                        let total = elapsed / (pct as f64 / 100.0);
                        (total - elapsed) as u64
                    } else { 0 };
                    let mut s = jobs_p.lock().unwrap();
                    if let Some(job) = s.get_mut(&id_p) {
                        job.progress = pct;
                        job.eta_secs = eta;
                    }
                }
            }
        }
    });

    let status = child.wait().await;
    progress_task.abort();
    let _ = tokio::fs::remove_file(&progress_file).await;

    match status {
        Ok(s) if s.success() => {
            let compressed_bytes = tokio::fs::metadata(&output)
                .await.map(|m| m.len()).unwrap_or(0);
            {
                let mut store = jobs.lock().unwrap();
                if let Some(job) = store.get_mut(&id) {
                    job.status = JobStatus::Done;
                    job.compressed_bytes = compressed_bytes;
                    job.progress = 100;
                    job.eta_secs = 0;
                }
            }
        }
        _ => set_status(&jobs, &id, JobStatus::Failed),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_us(content: &str) -> Option<u64> {
    content.lines()
        .filter_map(|l| l.strip_prefix("out_time_us="))
        .last()
        .and_then(|v| v.trim().parse().ok())
}

fn set_status(jobs: &JobStore, id: &str, status: JobStatus) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.status = status;
    }
}

fn extract_path(req: &Request) -> Result<String, Response> {
    let body: serde_json::Value = serde_json::from_slice(&req.body)
        .map_err(|_| Response { status: 400, body: r#"{"error":"expected JSON with 'path' field"}"#.into() })?;
    body["path"].as_str()
        .map(String::from)
        .ok_or_else(|| Response { status: 400, body: r#"{"error":"missing 'path' field"}"#.into() })
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    App::new()
        .config(Config {
            body_limit: 1024 * 1024,
            request_timeout: Duration::from_secs(600),
            cors_origin: Some("*".into()),
        })
        .state(AppState { jobs: Arc::new(Mutex::new(HashMap::new())) })
        .mount_routes()
        .listen("0.0.0.0:8080")
        .await;
}
