use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::get;
use crate::{auth::auth_and_rate, db::get_job, jobs::model::JobStatus, state::AppState};

#[get("/jobs/:id")]
pub async fn poll_job(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id = req.params.get("id").cloned().unwrap_or_default();
    let job = state.jobs.lock().unwrap().get(&id).cloned()
        .or_else(|| get_job(&state.db, &id));
    match job {
        Some(j) => Response { status: 200, body: serde_json::to_string(&j).unwrap().into(), ..Default::default() },
        None    => Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    }
}

#[get("/download/:id")]
pub async fn download(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id = req.params.get("id").cloned().unwrap_or_default();
    let job = state.jobs.lock().unwrap().get(&id).cloned()
        .or_else(|| get_job(&state.db, &id));
    match job {
        Some(j) if matches!(j.status, JobStatus::Done) => {
            match std::fs::read(&j.output_path) {
                Ok(bytes) => {
                    let mut res = Response::binary(200, bytes, content_type_for(&j.output_path));
                    res.headers.push(("cache-control".into(), "public, max-age=86400, immutable".into()));
                    res
                }
                Err(_) => Response { status: 404, body: r#"{"error":"output file missing"}"#.into(), ..Default::default() },
            }
        }
        Some(_) => Response { status: 409, body: r#"{"error":"job not done yet"}"#.into(), ..Default::default() },
        None    => Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    }
}

#[get("/health")]
pub async fn health(_req: Request) -> Response {
    Response { status: 200, body: r#"{"ok":true}"#.into(), ..Default::default() }
}

fn content_type_for(path: &str) -> &'static str {
    match std::path::Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "mp4"|"m4v"  => "video/mp4",
        "mov"        => "video/quicktime",
        "mkv"        => "video/x-matroska",
        "webm"       => "video/webm",
        "avi"        => "video/x-msvideo",
        "gif"        => "image/gif",
        "mp3"        => "audio/mpeg",
        "m4a"        => "audio/mp4",
        "ogg"        => "audio/ogg",
        "flac"       => "audio/flac",
        "wav"        => "audio/wav",
        "jpg"|"jpeg" => "image/jpeg",
        "png"        => "image/png",
        "webp"       => "image/webp",
        _            => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::content_type_for;
    #[test]
    fn content_type_matches_extension() {
        assert_eq!(content_type_for("/tmp/x.mp4"),        "video/mp4");
        assert_eq!(content_type_for("/tmp/x.mkv"),        "video/x-matroska");
        assert_eq!(content_type_for("/tmp/x.mp3"),        "audio/mpeg");
        assert_eq!(content_type_for("/tmp/x.flac"),       "audio/flac");
        assert_eq!(content_type_for("/tmp/x.png"),        "image/png");
        assert_eq!(content_type_for("/tmp/x.unknownext"), "application/octet-stream");
        assert_eq!(content_type_for("/tmp/no_ext"),       "application/octet-stream");
    }
}
