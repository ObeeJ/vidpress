use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::get;
use crate::{auth::auth_and_rate, db::get_job_for, state::AppState};

const MAX_PREVIEW: usize = 4 * 1024 * 1024;

#[get("/preview/:id")]
pub async fn preview(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    let id = req.params.get("id").cloned().unwrap_or_default();
    let caller_key = caller.as_ref().map(|k| k.key.as_str());
    let job = match get_job_for(&state.db, &id, caller_key) {
        Some(j) => j,
        None => return Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    };

    use tokio::io::AsyncReadExt;
    let mut f = match tokio::fs::File::open(&job.output_path).await {
        Ok(f) => f,
        Err(_) => return Response { status: 204, ..Default::default() },
    };
    let mut bytes = Vec::new();
    if f.take(MAX_PREVIEW as u64).read_to_end(&mut bytes).await.is_err() || bytes.is_empty() {
        return Response { status: 204, ..Default::default() };
    }

    let ct = content_type_for(&job.output_path);
    Response::binary(200, bytes, ct)
        .with_header("cache-control", "no-store")
        .with_header("cross-origin-resource-policy", "cross-origin")
        .with_header("x-job-status", &format!("{:?}", job.status).to_lowercase())
        .with_header("x-job-progress", &job.progress.to_string())
}

fn content_type_for(path: &str) -> &'static str {
    match std::path::Path::new(path)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str()
    {
        "mp4"|"m4v"  => "video/mp4",
        "mov"        => "video/quicktime",
        "mkv"        => "video/x-matroska",
        "webm"       => "video/webm",
        "mp3"        => "audio/mpeg",
        "m4a"        => "audio/mp4",
        "ogg"        => "audio/ogg",
        "flac"       => "audio/flac",
        "wav"        => "audio/wav",
        "jpg"|"jpeg" => "image/jpeg",
        "png"        => "image/png",
        "webp"       => "image/webp",
        "gif"        => "image/gif",
        _            => "application/octet-stream",
    }
}
