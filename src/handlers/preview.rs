use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::get;
use crate::{auth::auth_and_rate, db::get_job, state::AppState};

/// Streams the output file as it's being written by ffmpeg.
/// Uses HTTP range-style chunked delivery — browser <video> can play
/// a fragmented MP4 before the job is done.
#[get("/preview/:id")]
pub async fn preview(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let id = req.params.get("id").cloned().unwrap_or_default();
    let job = state.jobs.lock().unwrap().get(&id).cloned()
        .or_else(|| get_job(&state.db, &id));

    let job = match job {
        Some(j) => j,
        None => return Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    };

    // Read however many bytes exist right now — even if ffmpeg is mid-write
    let bytes = match std::fs::read(&job.output_path) {
        Ok(b) if !b.is_empty() => b,
        _ => return Response { status: 204, body: r#"{"error":"no data yet"}"#.into(), ..Default::default() },
    };

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
