use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use uuid::Uuid;
use crate::{
    auth::auth_and_rate,
    db::upsert_job,
    jobs::model::{DestinationConfig, Job, JobStatus},
    media::{detect::detect_with_hw, ffmpeg_args::format_ffmpeg_args},
    state::{AppState, storage_dir},
};

#[post("/upload")]
pub async fn upload(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };
    let path = match body["path"].as_str() {
        Some(p) => p.to_string(),
        None => return Response { status: 400, body: r#"{"error":"missing path"}"#.into(), ..Default::default() },
    };
    let webhook_url   = body["webhook_url"].as_str().map(String::from);
    let preset        = body["preset"].as_str().map(String::from);
    let output_format = body["output_format"].as_str().map(String::from);
    let destination: Option<DestinationConfig> = serde_json::from_value(body["destination"].clone()).ok();

    let mut profile = match detect_with_hw(&path, &state.hw).await {
        Ok(p)  => p,
        Err(e) => return Response { status: 415, body: format!(r#"{{"error":"{e}"}}"#).into(), ..Default::default() },
    };
    if let Some(ref fmt) = output_format {
        profile.output_ext = fmt.clone();
        profile.ffmpeg_args = format_ffmpeg_args(&profile.kind, fmt, &state.hw);
    }

    let id = Uuid::new_v4().to_string();
    let out_dir = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let output_path = format!("{}/{}_output.{}", out_dir, id, profile.output_ext);
    let eta = profile.estimated_time_secs;

    let job = Job {
        id: id.clone(), status: JobStatus::Queued,
        media_kind: profile.kind.clone(),
        input_path: path.clone(), output_path: output_path.clone(),
        original_bytes: profile.size_bytes, compressed_bytes: 0,
        duration_secs: profile.duration_secs, progress: 0, eta_secs: eta,
        webhook_url, preset: preset.clone(), destination, remote_url: None,
    };
    upsert_job(&state.db, &job);
    state.jobs.lock().unwrap().insert(id.clone(), job);

    let (jobs, db, id2, hw, sem) = (state.jobs.clone(), state.db.clone(), id.clone(), state.hw.clone(), state.job_sem.clone());
    tokio::spawn(async move {
        crate::jobs::compress::run(id2, path, output_path, profile, preset, jobs, db, hw, sem).await;
    });

    Response {
        status: 202,
        body: format!(r#"{{"job_id":"{id}","status":"queued","estimated_time_secs":{eta}}}"#).into(),
        ..Default::default()
    }
}
