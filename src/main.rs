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

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum JobStatus {
    Queued,
    Processing,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
struct Job {
    id: String,
    status: JobStatus,
    input_path: String,
    output_path: String,
    original_bytes: u64,
    compressed_bytes: u64,
    duration_secs: f64,
    /// 0–100
    progress: u8,
    /// estimated seconds remaining
    eta_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
struct VideoInfo {
    size_bytes: u64,
    size_mb: f64,
    duration_secs: f64,
    width: u64,
    height: u64,
    fps: f64,
    bitrate_mbps: f64,
    estimated_output_mb: f64,
    estimated_time_secs: u64,
}

type JobStore = Arc<Mutex<HashMap<String, Job>>>;

#[derive(Clone)]
struct AppState {
    jobs: JobStore,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /analyze  — body: { "path": "/abs/path/to/video.mp4" }
/// Returns video info + estimated compression time before any processing
#[post("/analyze")]
async fn analyze(req: Request) -> Response {
    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return bad_request("expected JSON body with 'path' field"),
    };
    let path = match body["path"].as_str() {
        Some(p) => p.to_string(),
        None => return bad_request("missing 'path' field"),
    };

    match probe_video(&path).await {
        Ok(info) => Response {
            status: 200,
            body: serde_json::to_string(&info).unwrap(),
        },
        Err(e) => Response {
            status: 422,
            body: format!(r#"{{"error":"{e}"}}"#),
        },
    }
}

/// POST /upload  — body: { "path": "/abs/path/to/video.mp4" }
#[post("/upload")]
async fn upload(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return bad_request("expected JSON body with 'path' field"),
    };
    let input_path = match body["path"].as_str() {
        Some(p) => p.to_string(),
        None => return bad_request("missing 'path' field"),
    };

    let meta = match tokio::fs::metadata(&input_path).await {
        Ok(m) => m,
        Err(_) => return bad_request("file not found"),
    };

    let info = match probe_video(&input_path).await {
        Ok(i) => i,
        Err(e) => return Response { status: 422, body: format!(r#"{{"error":"{e}"}}"#) },
    };

    let id = Uuid::new_v4().to_string();
    let output_path = format!("/tmp/{id}_output.mp4");

    let job = Job {
        id: id.clone(),
        status: JobStatus::Queued,
        input_path: input_path.clone(),
        output_path: output_path.clone(),
        original_bytes: meta.len(),
        compressed_bytes: 0,
        duration_secs: info.duration_secs,
        progress: 0,
        eta_secs: info.estimated_time_secs,
    };

    state.jobs.lock().unwrap().insert(id.clone(), job);

    let jobs = state.jobs.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        compress(id_clone, input_path, output_path, info.duration_secs, jobs).await;
    });

    Response {
        status: 202,
        body: format!(
            r#"{{"job_id":"{id}","status":"queued","estimated_time_secs":{}}}"#,
            info.estimated_time_secs
        ),
    }
}

/// GET /jobs/:id — poll status + progress + eta
#[get("/jobs/:id")]
async fn get_job(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let id = req.params.get("id").cloned().unwrap_or_default();

    let result = state.jobs.lock().unwrap().get(&id)
        .map(|job| (200u16, serde_json::to_string(job).unwrap()))
        .unwrap_or_else(|| (404, r#"{"error":"job not found"}"#.into()));

    Response { status: result.0, body: result.1 }
}

/// GET /health
#[get("/health")]
async fn health(_req: Request) -> Response {
    Response { status: 200, body: r#"{"ok":true}"#.into() }
}

// ── Compression ───────────────────────────────────────────────────────────────

async fn compress(id: String, input: String, output: String, duration_secs: f64, jobs: JobStore) {
    set_status(&jobs, &id, JobStatus::Processing);

    // FFmpeg writes progress to a named pipe
    let progress_file = format!("/tmp/{id}_progress");
    let _ = tokio::fs::remove_file(&progress_file).await;

    // Spawn FFmpeg with -progress flag
    let mut child = match Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &input,
            "-c:v", "libx265",
            "-preset", "ultrafast",
            "-crf", "24",
            "-c:a", "aac",
            "-b:a", "128k",
            "-progress", &progress_file,
            "-nostats",
            &output,
        ])
        .spawn()
    {
        Ok(c) => c,
        Err(_) => { set_status(&jobs, &id, JobStatus::Failed); return; }
    };

    // Poll progress file while FFmpeg runs
    let jobs_clone = jobs.clone();
    let id_clone = id.clone();
    let pf = progress_file.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(content) = tokio::fs::read_to_string(&pf).await {
                if let Some(us) = parse_progress_us(&content) {
                    let elapsed_secs = us as f64 / 1_000_000.0;
                    let pct = ((elapsed_secs / duration_secs) * 100.0).min(99.0) as u8;
                    let remaining = if pct > 0 {
                        let total_est = elapsed_secs / (pct as f64 / 100.0);
                        (total_est - elapsed_secs) as u64
                    } else { 0 };

                    let mut store = jobs_clone.lock().unwrap();
                    if let Some(job) = store.get_mut(&id_clone) {
                        job.progress = pct;
                        job.eta_secs = remaining;
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

fn parse_progress_us(content: &str) -> Option<u64> {
    // FFmpeg -progress writes "out_time_us=<microseconds>" lines
    content.lines()
        .filter_map(|l| l.strip_prefix("out_time_us="))
        .last()
        .and_then(|v| v.trim().parse::<u64>().ok())
}

fn set_status(jobs: &JobStore, id: &str, status: JobStatus) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.status = status;
    }
}

// ── Video probe ───────────────────────────────────────────────────────────────

async fn probe_video(path: &str) -> Result<VideoInfo, String> {
    let out = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| e.to_string())?;

    let fmt = &json["format"];
    let size_bytes: u64 = fmt["size"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let duration_secs: f64 = fmt["duration"].as_str().unwrap_or("0").parse().unwrap_or(0.0);
    let bitrate: f64 = fmt["bit_rate"].as_str().unwrap_or("0").parse().unwrap_or(0.0);

    let video = json["streams"].as_array()
        .and_then(|s| s.iter().find(|s| s["codec_type"] == "video"));

    let width = video.and_then(|v| v["width"].as_u64()).unwrap_or(0);
    let height = video.and_then(|v| v["height"].as_u64()).unwrap_or(0);
    let fps_str = video.and_then(|v| v["r_frame_rate"].as_str()).unwrap_or("30/1");
    let fps = parse_fps(fps_str);

    // H.265 ultrafast CRF 24 typically achieves ~90% reduction on high-bitrate mobile video
    let estimated_output_mb = (size_bytes as f64 / 1_048_576.0) * 0.10;
    // Rough: ~1.5x realtime on 8 cores with ultrafast
    let estimated_time_secs = (duration_secs * 1.5) as u64;

    Ok(VideoInfo {
        size_bytes,
        size_mb: size_bytes as f64 / 1_048_576.0,
        duration_secs,
        width,
        height,
        fps,
        bitrate_mbps: bitrate / 1_000_000.0,
        estimated_output_mb,
        estimated_time_secs,
    })
}

fn parse_fps(s: &str) -> f64 {
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 2 {
        let n: f64 = parts[0].parse().unwrap_or(30.0);
        let d: f64 = parts[1].parse().unwrap_or(1.0);
        if d != 0.0 { return n / d; }
    }
    30.0
}

fn bad_request(msg: &str) -> Response {
    Response { status: 400, body: format!(r#"{{"error":"{msg}"}}"#) }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let state = AppState {
        jobs: Arc::new(Mutex::new(HashMap::new())),
    };

    App::new()
        .config(Config {
            body_limit: 1024 * 1024,
            request_timeout: Duration::from_secs(600),
            cors_origin: Some("*".into()),
        })
        .state(state)
        .mount_routes()
        .listen("0.0.0.0:8080")
        .await;
}
