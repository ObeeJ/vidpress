use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use crate::{auth::auth_and_rate, handlers::analyze::json_err, jobs::model::JobStatus, state::AppState};

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

    let job = state.jobs.lock().unwrap_or_else(|e| e.into_inner()).get(job_id).cloned()
        .or_else(|| crate::db::get_job_for(&state.db, job_id, caller.as_ref().map(|k| k.key.as_str())));
    let (file_path, dest) = match job {
        Some(j) if matches!(j.status, JobStatus::Done) => (j.output_path, j.destination),
        Some(_) => return json_err(409, "job not completed yet"),
        None    => return json_err(404, "job not found"),
    };

    // Use destination from the job, or build one from request body.
    let cfg = dest.unwrap_or_else(|| crate::jobs::model::DestinationConfig {
        provider:     body["provider"].as_str().unwrap_or("s3").to_string(),
        bucket:       body["bucket"].as_str().map(String::from),
        endpoint:     body["endpoint"].as_str().map(String::from),
        region:       body["region"].as_str().map(String::from),
        access_key:   body["access_key"].as_str().map(String::from),
        secret_key:   body["secret_key"].as_str().map(String::from),
        access_token: None,
        target_path:  body["target_path"].as_str().map(String::from),
    });

    let remote_url = match cfg.provider.as_str() {
        "s3" | "r2" | "b2" | "supabase" => match crate::export::s3::upload(&cfg, &file_path).await {
            Ok(url) => url,
            Err(e) => { tracing::error!("export failed: {e}"); return json_err(502, "export failed"); }
        },
        // Fabricating a URL for a provider we don't support is worse than saying no. (C7)
        "gdrive" | "dropbox" => return json_err(501, "provider not yet supported"),
        _ => return json_err(400, "unknown provider"),
    };

    Response {
        status: 200,
        body: serde_json::json!({ "ok": true, "job_id": job_id, "remote_url": remote_url }).to_string().into(),
        ..Default::default()
    }
}
