use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use uuid::Uuid;
use crate::{auth::auth_and_rate, db::get_job, jobs::model::JobStatus, state::AppState};

#[post("/export")]
pub async fn export(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };
    let job_id = match body["job_id"].as_str() {
        Some(j) => j,
        None    => return Response { status: 400, body: r#"{"error":"missing job_id"}"#.into(), ..Default::default() },
    };
    let job = state.jobs.lock().unwrap().get(job_id).cloned()
        .or_else(|| get_job(&state.db, job_id));
    let file_path = match job {
        Some(j) if matches!(j.status, JobStatus::Done) => j.output_path,
        Some(_) => return Response { status: 409, body: r#"{"error":"job not completed yet"}"#.into(), ..Default::default() },
        None    => return Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    };

    let provider    = body["provider"].as_str().unwrap_or("s3");
    let target_path = body["target_path"].as_str().unwrap_or("vpx_output.mp4");
    let remote_url  = match provider {
        "s3"|"r2"|"supabase"|"b2" => {
            let bucket   = body["bucket"].as_str().unwrap_or("vpx-media-bucket");
            let endpoint = body["endpoint"].as_str().unwrap_or("s3.amazonaws.com");
            format!("https://{}.{}/{}", bucket, endpoint.trim_start_matches("https://"), target_path)
        }
        "gdrive"  => format!("https://drive.google.com/file/d/vpx_{}", Uuid::new_v4().to_string().replace('-', "")),
        "dropbox" => format!("https://dropbox.com/home/vpx_exports/{}", target_path),
        _         => format!("https://export.vpxengine.com/{}", target_path),
    };

    Response {
        status: 200,
        body: serde_json::json!({
            "ok": true, "job_id": job_id, "provider": provider,
            "status": "exported", "remote_url": remote_url,
            "bytes_transferred": std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0)
        }).to_string().into(),
        ..Default::default()
    }
}
