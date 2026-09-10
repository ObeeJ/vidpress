use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use crate::{auth::auth_and_rate, db::get_job_for, handlers::analyze::json_err, jobs::model::{DestinationConfig, JobStatus}, state::AppState};

#[post("/export")]
pub async fn export(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return json_err(400, "invalid json"),
    };
    let job_id = match body["job_id"].as_str() {
        Some(j) => j,
        None    => return json_err(400, "missing job_id"),
    };
    let caller_key = caller.as_ref().map(|k| k.key.as_str());
    let job = {
        let store = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
        store.get(job_id).filter(|j| j.owner_key.as_deref() == caller_key).cloned()
    }.or_else(|| get_job_for(&state.db, job_id, caller_key));

    let (file_path, dest) = match job {
        Some(j) if matches!(j.status, JobStatus::Done) => (j.output_path, j.destination),
        Some(_) => return json_err(409, "job not completed yet"),
        None    => return json_err(404, "job not found"),
    };

    let provider = body["provider"].as_str().unwrap_or("s3");

    let remote_url = match provider {
        "s3" | "r2" | "b2" | "supabase" => {
            // A destination attached at /upload time wins. Otherwise accept one
            // inline on this request: that lets a caller export a job they
            // queued without credentials, which is the flow the UI uses.
            // Keys sent this way are scoped to this single transfer and are
            // never written to the database (db.rs strips them on persist), so
            // nothing here may log `cfg` or echo it back in the response.
            let cfg = match dest {
                Some(d) => d,
                None => match serde_json::from_value::<DestinationConfig>(body["destination"].clone()) {
                    Ok(d) => d,
                    Err(_) => return json_err(
                        400,
                        "no destination for this job attach one at /upload or pass `destination` here",
                    ),
                },
            };
            match crate::export::s3::upload(&cfg, &file_path).await {
                Ok(url) => url,
                Err(e) => {
                    tracing::error!("export failed: {e}");
                    return json_err(502, "export failed");
                }
            }
        }
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
