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
}

type JobStore = Arc<Mutex<HashMap<String, Job>>>;

#[derive(Clone)]
struct AppState {
    jobs: JobStore,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /upload  — body is raw video bytes
/// In production, swap body bytes for a pre-signed S3 URL flow
#[post("/upload")]
async fn upload(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();

    let id = Uuid::new_v4().to_string();
    let input_path = format!("/tmp/{id}_input.mp4");
    let output_path = format!("/tmp/{id}_output.mp4");
    let original_bytes = req.body.len() as u64;

    // Write uploaded bytes to disk
    if let Err(e) = tokio::fs::write(&input_path, &req.body).await {
        return Response {
            status: 500,
            body: format!(r#"{{"error":"failed to save upload: {e}"}}"#),
        };
    }

    let job = Job {
        id: id.clone(),
        status: JobStatus::Queued,
        input_path: input_path.clone(),
        output_path: output_path.clone(),
        original_bytes,
        compressed_bytes: 0,
    };

    state.jobs.lock().unwrap().insert(id.clone(), job);

    // Spawn compression in background
    let jobs = state.jobs.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        compress(id_clone, input_path, output_path, jobs).await;
    });

    Response {
        status: 202,
        body: format!(r#"{{"job_id":"{id}","status":"queued"}}"#),
    }
}

/// GET /jobs/:id — poll compression status
#[get("/jobs/:id")]
async fn get_job(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let id = req.params.get("id").cloned().unwrap_or_default();

    let body = state.jobs.lock().unwrap().get(&id)
        .map(|job| (200u16, serde_json::to_string(job).unwrap()))
        .unwrap_or_else(|| (404, r#"{"error":"job not found"}"#.into()));

    Response { status: body.0, body: body.1 }
}

/// GET /health
#[get("/health")]
async fn health(_req: Request) -> Response {
    Response { status: 200, body: r#"{"ok":true}"#.into() }
}

// ── Compression ───────────────────────────────────────────────────────────────

async fn compress(id: String, input: String, output: String, jobs: JobStore) {
    set_status(&jobs, &id, JobStatus::Processing);

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i", &input,
            "-c:v", "libx265",
            "-preset", "ultrafast",
            "-crf", "24",
            "-c:a", "aac",
            "-b:a", "128k",
            &output,
        ])
        .output()
        .await;

    match status {
        Ok(out) if out.status.success() => {
            let compressed_bytes = tokio::fs::metadata(&output)
                .await
                .map(|m| m.len())
                .unwrap_or(0);

            {
                let mut store = jobs.lock().unwrap();
                if let Some(job) = store.get_mut(&id) {
                    job.status = JobStatus::Done;
                    job.compressed_bytes = compressed_bytes;
                }
            } // drop MutexGuard before await

            let _ = tokio::fs::remove_file(&input).await;
        }
        _ => set_status(&jobs, &id, JobStatus::Failed),
    }
}

fn set_status(jobs: &JobStore, id: &str, status: JobStatus) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.status = status;
    }
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
            body_limit: 1024 * 1024 * 1024, // 1 GB
            request_timeout: Duration::from_secs(300),
            cors_origin: Some("*".into()),
        })
        .state(state)
        .mount_routes()
        .listen("0.0.0.0:8080")
        .await;
}
