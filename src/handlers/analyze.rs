use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use crate::{auth::auth_and_rate, media::detect::detect, state::AppState};

#[post("/analyze")]
pub async fn analyze(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let path = match extract_path(&req) { Ok(p) => p, Err(r) => return r };
    match detect(&path).await {
        Ok(p)  => Response { status: 200, body: serde_json::to_string(&p).unwrap().into(), ..Default::default() },
        Err(e) => Response { status: 415, body: format!(r#"{{"error":"{e}"}}"#).into(), ..Default::default() },
    }
}

pub fn extract_path(req: &Request) -> Result<String, Response> {
    let body: serde_json::Value = serde_json::from_slice(&req.body)
        .map_err(|_| Response { status: 400, body: r#"{"error":"expected JSON with 'path' field"}"#.into(), ..Default::default() })?;
    body["path"].as_str().map(String::from)
        .ok_or_else(|| Response { status: 400, body: r#"{"error":"missing 'path' field"}"#.into(), ..Default::default() })
}
