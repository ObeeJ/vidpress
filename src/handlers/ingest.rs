use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use uuid::Uuid;
use crate::{auth::auth_and_rate, handlers::analyze::json_err, media::path_guard::ingest_dir, state::{AppState, ALLOWED_EXTS}};

#[post("/ingest")]
pub async fn ingest(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    let raw_name = req.headers.get("x-file-name").cloned().unwrap_or_else(|| "upload.bin".into());
    let ext = std::path::Path::new(&raw_name)
        .extension().and_then(|e| e.to_str()).unwrap_or("bin")
        .to_lowercase();
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Response { status: 415, body: r#"{"error":"unsupported file type"}"#.into(), ..Default::default() };
    }

    let dir = ingest_dir();
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        tracing::error!("cannot create ingest dir {dir}: {e}");
        return Response { status: 500, body: r#"{"error":"storage unavailable"}"#.into(), ..Default::default() };
    }
    let path = format!("{dir}/theflate_{}.{}", Uuid::new_v4(), ext);

    if let Err(e) = tokio::fs::write(&path, &req.body).await {
        tracing::error!("ingest write failed: {e}");
        return json_err(500, "storage unavailable");
    }

    let path = remux_to_mp4_if_needed(&path).await;
    let ingest_id = Uuid::new_v4().to_string();
    if let Err(e) = crate::ingest_store::record(
        &state.db, &ingest_id, &path, caller.as_ref().map(|k| k.key.as_str())
    ) {
        tracing::error!("ingest record failed: {e}");
        return json_err(500, "storage unavailable");
    }

    Response {
        status: 200,
        body: serde_json::json!({ "ingest_id": ingest_id }).to_string().into(),
        ..Default::default()
    }
}

async fn remux_to_mp4_if_needed(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !matches!(ext.as_str(), "mov"|"avi"|"mkv") { return path.to_string(); }
    let out = format!("{}.mp4", &path[..path.len() - ext.len() - 1]);
    match tokio::process::Command::new("ffmpeg")
        .args(["-y", "-i", path, "-c", "copy", "-movflags", "+faststart", &out])
        .output().await
    {
        Ok(o) if o.status.success() => { let _ = tokio::fs::remove_file(path).await; out }
        _ => path.to_string(),
    }
}
