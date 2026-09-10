use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use crate::{auth::auth_and_rate, media::detect::detect, state::AppState};

#[post("/analyze")]
pub async fn analyze(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return json_err(400, "expected JSON body"),
    };
    let ingest_id = match body["ingest_id"].as_str() {
        Some(s) => s,
        None => return json_err(400, "missing ingest_id"),
    };
    let path = match crate::ingest_store::resolve(
        &state.db, ingest_id, caller.as_ref().map(|k| k.key.as_str())
    ) {
        Some(p) => p,
        None => return json_err(404, "unknown or expired ingest_id"),
    };

    match detect(&path).await {
        Ok(p)  => Response { status: 200, body: serde_json::to_string(&p).unwrap().into(), ..Default::default() },
        Err(_) => json_err(415, "unsupported media type"),
    }
}

/// Build a correctly-escaped JSON error. Never interpolate an error string
/// into a format! literal - ffprobe messages contain quotes and produce
/// invalid JSON that the frontend's r.json() throws on. (M1)
pub fn json_err(status: u16, msg: &str) -> Response {
    Response { status, body: serde_json::json!({ "error": msg }).to_string().into(), ..Default::default() }
}
