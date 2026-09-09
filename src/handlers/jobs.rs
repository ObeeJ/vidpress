use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::get;
use crate::{auth::auth_and_rate, db::get_job, jobs::model::JobStatus, state::AppState};

/// Parse an RFC 7233 single byte-range against a known total size.
///
/// Returns `None` for anything malformed, inverted, or past EOF. The previous
/// inline version computed `end - start + 1` on unvalidated input, so
/// `Range: bytes=99999999999-` underflowed to roughly u64::MAX and became a
/// `vec![0u8; that]` allocation -- a one-request remote DoS. (C8)
pub fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 { return None; }
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') { return None; }
    let (s, e) = spec.split_once('-')?;

    let start: u64 = s.trim().parse().ok()?;
    let end: u64 = match e.trim() {
        "" => total - 1,
        v  => v.parse().ok()?,
    };

    let end = end.min(total - 1);
    if start > end { return None; }
    Some((start, end))
}

/// Never materialise more than this per request.
const MAX_CHUNK: u64 = 8 * 1024 * 1024;

#[get("/jobs/:id")]
pub async fn poll_job(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id = req.params.get("id").cloned().unwrap_or_default();
    let job = state.jobs.lock().unwrap_or_else(|e| e.into_inner()).get(&id).cloned()
        .or_else(|| get_job(&state.db, &id));
    match job {
        Some(j) => Response { status: 200, body: serde_json::to_string(&j.public()).unwrap().into(), ..Default::default() },
        None    => Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    }
}

#[get("/download/:id")]
pub async fn download(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id = req.params.get("id").cloned().unwrap_or_default();
    let job = state.jobs.lock().unwrap_or_else(|e| e.into_inner()).get(&id).cloned()
        .or_else(|| get_job(&state.db, &id));
    match job {
        Some(j) if matches!(j.status, JobStatus::Done) => {
            let meta = match std::fs::metadata(&j.output_path) {
                Ok(m) => m,
                Err(_) => return Response { status: 404, body: r#"{"error":"output file missing"}"#.into(), ..Default::default() },
            };
            let total = meta.len();
            let ct = content_type_for(&j.output_path);

            let raw_range = req.headers.get("range");
            let range = raw_range.and_then(|h| parse_range(h, total));
            if raw_range.is_some() && range.is_none() {
                return Response { status: 416, body: r#"{"error":"invalid range"}"#.into(), ..Default::default() };
            }
            let (start, mut end, status) = match range {
                Some((s, e)) => (s, e, 206u16),
                None         => (0, total.saturating_sub(1), 200u16),
            };
            end = end.min(start + MAX_CHUNK - 1);
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
            // Private media must not be cached by CDNs or shared caches. (H11)
            res.headers.push(("cache-control".into(), "private, no-store".into()));
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
    use super::*;

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
