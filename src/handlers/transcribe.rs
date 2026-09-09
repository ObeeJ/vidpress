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
    let model  = if caller.as_ref().map(|k| k.plan == "premium").unwrap_or(false) { "medium" } else { "base" };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };

    let jid = match body["job_id"].as_str() {
        Some(j) => j.to_string(),
        None    => return Response { status: 400, body: r#"{"error":"missing job_id"}"#.into(), ..Default::default() },
    };

    let job = get_job_for(&state.db, &jid, caller.as_ref().map(|k| k.key.as_str()));
    let path = match job {
        Some(j) if matches!(j.status, JobStatus::Done) => j.output_path,
        Some(_) => return Response { status: 409, body: r#"{"error":"job not done yet"}"#.into(), ..Default::default() },
        None    => return Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
    };

    let tid     = Uuid::new_v4().to_string();
    let out_dir = storage_dir();
    let model   = model.to_string();

    // Insert queued row immediately so the caller can poll. (M7)
    {
        let conn = state.db.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO transcriptions(id,job_id,text,status) VALUES(?1,?2,'',?3)
             ON CONFLICT(id) DO NOTHING",
            params![tid, jid, "queued"],
        ).ok();
    }

    let db = state.db.clone();
    let sem = state.job_sem.clone();
    let tid2 = tid.clone();
    tokio::spawn(async move {
        let _permit = sem.acquire_owned().await;
        let out_file = format!("{}/{}_transcript.json", out_dir, tid2);
        let whisper_result = Command::new("whisper")
            .args([&path, "--model", &model, "--output_format", "json", "--output_dir", &out_dir])
            .output().await;

        let (text, status) = match whisper_result {
            Ok(o) if o.status.success() => {
                let stem = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
                let whisper_out = format!("{}/{}.json", out_dir, stem);
                let raw = tokio::fs::read_to_string(&whisper_out).await
                    .unwrap_or_else(|_| String::from_utf8_lossy(&o.stdout).into_owned());
                let text = serde_json::from_str::<serde_json::Value>(&raw)
                    .ok().and_then(|v| v["text"].as_str().map(|s| s.to_string()))
                    .unwrap_or(raw);
                let _ = tokio::fs::rename(&whisper_out, &out_file).await;
                (text, "done")
            }
            Ok(o) => {
                tracing::error!("whisper failed:\n{}", String::from_utf8_lossy(&o.stderr));
                (String::new(), "failed")
            }
            Err(e) => {
                tracing::error!("whisper spawn error: {e}");
                (String::new(), "failed")
            }
        };

        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "UPDATE transcriptions SET text=?1, status=?2 WHERE id=?3",
            params![text, status, tid2],
        ).ok();
    });

    Response { status: 202, body: serde_json::json!({ "transcription_id": tid }).to_string().into(), ..Default::default() }
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
            "status": r.get::<_,Option<String>>(3)?.unwrap_or_else(|| "done".into())
        })),
    ) {
        Ok(v)  => Response { status: 200, body: v.to_string().into(), ..Default::default() },
        Err(_) => Response { status: 404, body: r#"{"error":"not found"}"#.into(), ..Default::default() },
    }
}
