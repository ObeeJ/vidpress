use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use crate::{auth::auth_and_rate, db::get_job, handlers::analyze::json_err, jobs::model::JobStatus, state::AppState};

#[post("/export")]
pub async fn export(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return json_err(400, "invalid json"),
    };
    let job_id = match body["job_id"].as_str() {
        Some(j) => j,
        None    => return json_err(400, "missing job_id"),
    };
    let job = state.jobs.lock().unwrap_or_else(|e| e.into_inner()).get(job_id).cloned()
        .or_else(|| get_job(&state.db, job_id));
    let (file_path, dest) = match job {
        Some(j) if matches!(j.status, JobStatus::Done) => (j.output_path, j.destination),
        Some(_) => return json_err(409, "job not completed yet"),
        None    => return json_err(404, "job not found"),
    };

    let provider = body["provider"].as_str().unwrap_or("s3");

    let remote_url = match provider {
        "s3" | "r2" | "b2" | "supabase" => {
            let cfg = match dest {
                Some(d) => d,
                None => return json_err(400, "no destination configured for this job"),
            };
            match crate::export::s3::upload(&cfg, &file_path).await {
                Ok(url) => url,
                Err(e) => {
                    tracing::error!("export failed: {e}");
                    return json_err(502, "export failed");
                }
            }
        }
        // Fabricating a plausible URL for a provider we do not support is worse
        // than saying no — the customer discovers it when the file isn't there. (C7)
        "gdrive" | "dropbox" => return json_err(501, "provider not yet supported"),
        _ => return json_err(400, "unknown provider"),
    };

    Response {
        status: 200,
        body: serde_json::json!({
            "ok": true, "job_id": job_id, "provider": provider,
            "status": "exported", "remote_url": remote_url
        }).to_string().into(),
        ..Default::default()
    }
}
