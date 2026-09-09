use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use uuid::Uuid;
use crate::{
    auth::auth_and_rate,
    db::upsert_job,
    handlers::analyze::json_err,
    jobs::model::{DestinationConfig, Job, JobStatus},
    media::{detect::detect_with_hw, ffmpeg_args::format_ffmpeg_args, path_guard::resolve_output_ext},
    state::{AppState, storage_dir},
};

#[post("/upload")]
pub async fn upload(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return json_err(400, "invalid json"),
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

    let webhook_url   = body["webhook_url"].as_str().map(String::from);
    let preset        = body["preset"].as_str().map(String::from);
    let output_format = body["output_format"].as_str().map(String::from);
    let target_mb     = body["target_mb"].as_f64();
    let destination: Option<DestinationConfig> = serde_json::from_value(body["destination"].clone()).ok();

    let mut profile = match detect_with_hw(&path, &state.hw).await {
        Ok(p)  => p,
        Err(_) => return json_err(415, "unsupported media type"),
    };
    if let Some(ref fmt) = output_format {
        let ext = match resolve_output_ext(fmt) {
            Ok(e) => e,
            Err(_) => return json_err(400, "unsupported output format"),
        };
        profile.ffmpeg_args = format_ffmpeg_args(&profile.kind, &ext, &state.hw);
        profile.output_ext = ext;
    }

    let id = Uuid::new_v4().to_string();
    let out_dir = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let output_path = format!("{}/{}_output.{}", out_dir, id, profile.output_ext);
    let eta = profile.estimated_time_secs;
    let owner_key = caller.as_ref().map(|k| k.key.clone());

    let job = Job {
        id: id.clone(), status: JobStatus::Queued,
        media_kind: profile.kind.clone(),
        input_path: path.clone(), output_path: output_path.clone(),
        original_bytes: profile.size_bytes, compressed_bytes: 0,
        duration_secs: profile.duration_secs, progress: 0, eta_secs: eta,
        webhook_url, preset: preset.clone(), destination, remote_url: None,
        owner_key,
    };
    upsert_job(&state.db, &job);
    state.jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), job);

    let (jobs, db, id2, hw, sem) = (state.jobs.clone(), state.db.clone(), id.clone(), state.hw.clone(), state.job_sem.clone());
    tokio::spawn(async move {
        crate::jobs::compress::run(id2, path, output_path, profile, preset, target_mb, jobs, db, hw, sem).await;
    });

    Response {
        status: 202,
        body: format!(r#"{{"job_id":"{id}","status":"queued","estimated_time_secs":{eta}}}"#).into(),
        ..Default::default()
    }
}
