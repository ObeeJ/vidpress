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
            let meta = match std::fs::metadata(&j.output_path) {
                Ok(m) => m,
                Err(_) => return Response { status: 404, body: r#"{"error":"output file missing"}"#.into(), ..Default::default() },
            };
            let total = meta.len();
            let ct = content_type_for(&j.output_path);

            // Parse Range header
            let range = req.headers.get("range").and_then(|v| {
                let v = v.trim().strip_prefix("bytes=")?;
                let mut parts = v.splitn(2, '-');
                let start: u64 = parts.next()?.trim().parse().ok()?;
                let end: u64 = parts.next().and_then(|e| e.trim().parse().ok()).unwrap_or(total - 1);
                Some((start, end.min(total - 1)))
            });

            let (start, end, status) = match range {
                Some((s, e)) => (s, e, 206u16),
                None         => (0, total - 1, 200u16),
            };

            let len = end - start + 1;
            let bytes = match read_range(&j.output_path, start, len) {
                Ok(b) => b,
                Err(_) => return Response { status: 500, body: r#"{"error":"read failed"}"#.into(), ..Default::default() },
            };

            let mut res = Response::binary(status, bytes, ct);
            let filename = std::path::Path::new(&j.output_path).file_name().and_then(|n| n.to_str()).unwrap_or("output");
            res.headers.push(("content-disposition".into(), format!("attachment; filename=\"{filename}\"")));
            res.headers.push(("accept-ranges".into(), "bytes".into()));
            res.headers.push(("content-length".into(), len.to_string()));
            res.headers.push(("content-range".into(), format!("bytes {start}-{end}/{total}")));
            res.headers.push(("cache-control".into(), "public, max-age=86400, immutable".into()));
            res.headers.push(("cross-origin-resource-policy".into(), "cross-origin".into()));
            res
        }
        Some(_) => Response { status: 409, body: r#"{"error":"job not done yet"}"#.into(), ..Default::default() },
        None    => Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    }
}

fn read_range(path: &str, offset: u64, len: u64) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; len as usize];
    f.read_exact(&mut buf)?;
    Ok(buf)
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
