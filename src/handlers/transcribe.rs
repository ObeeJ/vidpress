use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::{get, post};
use rusqlite::params;
use tokio::process::Command;
use uuid::Uuid;
use crate::{auth::auth_and_rate, db::get_job_for, jobs::model::JobStatus, state::{AppState, storage_dir}};

#[post("/transcribe")]
pub async fn transcribe(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    // No paid tiers are live yet, so every caller gets the best model.
    // Revisit once payment verification exists.
    let model = "large-v3";

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };

    let caller_key = caller.as_ref().map(|k| k.key.as_str());
    let job_id_owned = match body["job_id"].as_str() {
        Some(s) => s.to_string(),
        None => return Response { status: 400, body: r#"{"error":"missing job_id"}"#.into(), ..Default::default() },
    };
    let path = {
        let job = {
            let store = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
            store.get(job_id_owned.as_str()).filter(|j| j.owner_key.as_deref() == caller_key).cloned()
        }.or_else(|| get_job_for(&state.db, &job_id_owned, caller_key));
        match job {
            Some(j) if matches!(j.status, JobStatus::Done) => j.output_path,
            Some(_) => return Response { status: 409, body: r#"{"error":"job not done yet"}"#.into(), ..Default::default() },
            None    => return Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
        }
    };

    let tid = Uuid::new_v4().to_string();
    {
        let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO transcriptions(id,job_id,text,status) VALUES(?1,?2,'',?3)",
            params![tid, job_id_owned, "queued"],
        ).ok();
    }

    // Whisper used to run synchronously inside this handler: it bypassed
    // job_sem (the same semaphore /upload uses to bound concurrent ffmpeg/
    // whisper processes), and held the HTTP connection open for as long as
    // transcription took — with the "medium" model, that's minutes. The 600s
    // request_timeout would drop the connection but tokio::process::Command
    // does not kill_on_drop by default, so the whisper process kept running
    // orphaned in the background. (M7, M8)
    let (db, jobs_store, sem, tid2, path2, model2) =
        (state.db.clone(), state.jobs.clone(), state.job_sem.clone(), tid.clone(), path.clone(), model.to_string());
    tokio::spawn(async move {
        let _permit = sem.acquire_owned().await;
        run_transcription(tid2, path2, model2, db, jobs_store).await;
    });

    Response {
        status: 202,
        body: serde_json::json!({ "transcription_id": tid, "status": "queued" }).to_string().into(),
        ..Default::default()
    }
}

async fn run_transcription(
    tid: String,
    path: String,
    model: String,
    db: crate::state::Db,
    _jobs_store: crate::state::JobStore,
) {
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("UPDATE transcriptions SET status='processing' WHERE id=?1", params![tid]).ok();
    }

    let out_dir = storage_dir();
    let out_file = format!("{}/{}_transcript.json", out_dir, tid);
    let stem = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let out_stem = format!("{}/{}", out_dir, stem);

    let default_model_path = std::env::var("WHISPER_MODEL_PATH").unwrap_or_else(|_| "/app/models/ggml-base.bin".to_string());
    
    // Try whisper-cli (whisper.cpp native engine) first, fallback to whisper-ctranslate2
    let is_whisper_cli = Command::new("whisper-cli").arg("--help").output().await.is_ok();
    
    let whisper_result = if is_whisper_cli {
        Command::new("whisper-cli")
            .args(["-m", &default_model_path, "-f", &path, "-oj", "-of", &out_stem])
            .kill_on_drop(true)
            .output().await
    } else {
        Command::new("whisper-ctranslate2")
            .args([&path, "--model", &model, "--compute_type", "int8", "--output_format", "json", "--output_dir", &out_dir])
            .kill_on_drop(true)
            .output().await
    };

    match whisper_result {
        Ok(o) if o.status.success() => {
            let whisper_out = format!("{}/{}.json", out_dir, stem);
            let raw = tokio::fs::read_to_string(&whisper_out).await
                .unwrap_or_else(|_| String::from_utf8_lossy(&o.stdout).into_owned());
            let parsed: Option<serde_json::Value> = serde_json::from_str(&raw).ok();
            let text = parsed.as_ref()
                .and_then(|v| v["text"].as_str().map(|s| s.to_string()))
                .or_else(|| {
                    parsed.as_ref().and_then(|v| v["transcription"].as_array()).map(|arr| {
                        arr.iter().filter_map(|seg| seg["text"].as_str()).collect::<Vec<_>>().join(" ")
                    })
                })
                .unwrap_or(raw);

            {
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                conn.execute(
                    "UPDATE transcriptions SET text=?1, status='done' WHERE id=?2",
                    params![text, tid],
                ).ok();
            }
            let _ = tokio::fs::rename(&whisper_out, &out_file).await;
        }
        Ok(o) => {
            tracing::error!("whisper failed for transcription {tid} (exit {:?}):\n{}", o.status.code(), String::from_utf8_lossy(&o.stderr));
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            conn.execute("UPDATE transcriptions SET status='failed' WHERE id=?1", params![tid]).ok();
        }
        Err(e) => {
            tracing::error!("whisper spawn error for transcription {tid}: {e}");
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            conn.execute("UPDATE transcriptions SET status='failed' WHERE id=?1", params![tid]).ok();
        }
    }
}

#[get("/transcriptions/:id")]
pub async fn get_transcription(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id   = req.params.get("id").cloned().unwrap_or_default();
    let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
    match conn.query_row(
        "SELECT id,job_id,text,status FROM transcriptions WHERE id=?1",
        params![id],
        |r| Ok(serde_json::json!({
            "id": r.get::<_,String>(0)?,
            "job_id": r.get::<_,String>(1)?,
            "text": r.get::<_,String>(2)?,
            "status": r.get::<_,Option<String>>(3)?.unwrap_or_else(|| "done".to_string()),
        })),
    ) {
        Ok(v)  => Response { status: 200, body: v.to_string().into(), ..Default::default() },
        Err(_) => Response { status: 404, body: r#"{"error":"not found"}"#.into(), ..Default::default() },
    }
}
