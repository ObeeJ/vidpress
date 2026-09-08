use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use uuid::Uuid;
use crate::{
    auth::auth_and_rate,
    db::upsert_job,
    jobs::model::{DestinationConfig, Job, JobStatus},
    media::detect::MediaKind,
    state::{AppState, storage_dir},
};

fn is_safe_url(url: &str) -> bool {
    let url = url.trim();
    if !url.starts_with("http://") && !url.starts_with("https://") { return false; }
    let after = url.splitn(2, "://").nth(1).unwrap_or("");
    let host  = after.splitn(2, '/').next().unwrap_or("");
    let host  = if host.starts_with('[') { host.splitn(2, ']').next().unwrap_or(host) }
                else { host.splitn(2, ':').next().unwrap_or(host) };
    let blocked = ["localhost","127.","0.0.0.0","169.254.","10.","192.168.","[::1]","[::]"];
    let is_172_private = host.starts_with("172.") && {
        host.splitn(3, '.').nth(1)
            .and_then(|s| s.parse::<u8>().ok())
            .map(|n| (16..=31).contains(&n))
            .unwrap_or(false)
    };
    !is_172_private && !blocked.iter().any(|b| host.starts_with(b))
}

#[post("/download-url")]
pub async fn download_url(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };
    let url = match body["url"].as_str() {
        Some(u) => u.to_string(),
        None    => return Response { status: 400, body: r#"{"error":"missing url"}"#.into(), ..Default::default() },
    };
    if !is_safe_url(&url) {
        return Response { status: 400, body: r#"{"error":"invalid or disallowed url"}"#.into(), ..Default::default() };
    }

    let audio_only  = body["audio_only"].as_bool().unwrap_or(false);
    let webhook_url = body["webhook_url"].as_str().map(String::from);
    let destination: Option<DestinationConfig> = serde_json::from_value(body["destination"].clone()).ok();
    let id          = Uuid::new_v4().to_string();
    let out_dir     = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let ext         = if audio_only { "mp3" } else { "mp4" };
    let output_path = format!("{}/{}_dl.{}", out_dir, id, ext);

    let job = Job {
        id: id.clone(), status: JobStatus::Queued,
        media_kind: if audio_only { MediaKind::AudioLossy } else { MediaKind::Video },
        input_path: url.clone(), output_path: output_path.clone(),
        original_bytes: 0, compressed_bytes: 0, duration_secs: 0.0,
        progress: 0, eta_secs: 60, webhook_url, preset: None, destination, remote_url: None,
    };
    upsert_job(&state.db, &job);
    state.jobs.lock().unwrap().insert(id.clone(), job);

    let (jobs, db, id2) = (state.jobs.clone(), state.db.clone(), id.clone());
    tokio::spawn(async move {
        crate::jobs::yt_dlp::run(id2, url, output_path, audio_only, jobs, db).await;
    });

    Response { status: 202, body: serde_json::json!({ "job_id": id, "status": "queued" }).to_string().into(), ..Default::default() }
}
