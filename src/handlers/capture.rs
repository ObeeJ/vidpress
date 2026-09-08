use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use uuid::Uuid;
use crate::{auth::auth_and_rate, jobs::capture, state::AppState};

#[post("/capture/start")]
pub async fn capture_start(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = serde_json::from_slice(&req.body).unwrap_or_default();
    let display    = body["display"].as_str().unwrap_or(":0.0");
    let fps        = body["fps"].as_u64().unwrap_or(30) as u8;
    let resolution = body["resolution"].as_str().unwrap_or("1920x1080");

    let id = Uuid::new_v4().to_string();
    match capture::start(id.clone(), display, fps, resolution, &state.jobs, &state.db, &state.captures).await {
        Ok(()) => Response {
            status: 200,
            body: serde_json::json!({ "job_id": id, "status": "recording" }).to_string().into(),
            ..Default::default()
        },
        Err(e) => Response {
            status: 500,
            body: format!(r#"{{"error":"{e}"}}"#).into(),
            ..Default::default()
        },
    }
}

#[post("/capture/stop")]
pub async fn capture_stop(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = serde_json::from_slice(&req.body).unwrap_or_default();
    let id = match body["job_id"].as_str() {
        Some(id) => id.to_string(),
        None => return Response { status: 400, body: r#"{"error":"missing job_id"}"#.into(), ..Default::default() },
    };

    match capture::stop(&id, &state.jobs, &state.db, &state.captures).await {
        Ok(path) => Response {
            status: 200,
            body: serde_json::json!({ "job_id": id, "status": "done", "output_path": path }).to_string().into(),
            ..Default::default()
        },
        Err(e) => Response {
            status: 404,
            body: format!(r#"{{"error":"{e}"}}"#).into(),
            ..Default::default()
        },
    }
}
