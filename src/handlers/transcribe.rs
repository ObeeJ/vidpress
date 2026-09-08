use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::{get, post};
use rusqlite::params;
use tokio::process::Command;
use uuid::Uuid;
use crate::{auth::auth_and_rate, db::get_job, jobs::model::JobStatus, state::{AppState, storage_dir}};

#[post("/transcribe")]
pub async fn transcribe(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };
    let model  = if caller.as_ref().map(|k| k.plan == "premium").unwrap_or(false) { "medium" } else { "base" };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };

    let path = if let Some(jid) = body["job_id"].as_str() {
        let job = state.jobs.lock().unwrap().get(jid).cloned()
            .or_else(|| get_job(&state.db, jid));
        match job {
            Some(j) if matches!(j.status, JobStatus::Done) => j.output_path,
            Some(_) => return Response { status: 409, body: r#"{"error":"job not done yet"}"#.into(), ..Default::default() },
            None    => return Response { status: 404, body: r#"{"error":"job not found"}"#.into(), ..Default::default() },
        }
    } else if let Some(p) = body["path"].as_str() {
        p.to_string()
    } else {
        return Response { status: 400, body: r#"{"error":"provide job_id or path"}"#.into(), ..Default::default() };
    };

    let tid     = Uuid::new_v4().to_string();
    let out_dir = storage_dir();
    let out_file = format!("{}/{}_transcript.json", out_dir, tid);

    let whisper_result = Command::new("whisper")
        .args([&path, "--model", model, "--output_format", "json", "--output_dir", &out_dir])
        .output().await;

    match whisper_result {
        Ok(o) if o.status.success() => {
            let stem = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("output");
            let whisper_out = format!("{}/{}.json", out_dir, stem);
            let raw = tokio::fs::read_to_string(&whisper_out).await
                .unwrap_or_else(|_| String::from_utf8_lossy(&o.stdout).into_owned());
            // whisper json has a "text" field; fall back to raw if not
            let text = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| v["text"].as_str().map(|s| s.to_string()))
                .unwrap_or(raw);
            {
                let conn = state.db.lock().unwrap();
                conn.execute(
                    "INSERT INTO transcriptions(id,job_id,text) VALUES(?1,?2,?3)",
                    params![tid, body["job_id"].as_str().unwrap_or(""), &text],
                ).ok();
            }
            let _ = tokio::fs::rename(&whisper_out, &out_file).await;
            Response { status: 200, body: serde_json::json!({ "id": tid, "text": text, "model": model }).to_string().into(), ..Default::default() }
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            tracing::error!("whisper failed (exit {:?}):\n{}", o.status.code(), stderr);
            Response { status: 500, body: serde_json::json!({ "error": "transcription failed", "detail": stderr.trim() }).to_string().into(), ..Default::default() }
        }
        Err(e) => {
            tracing::error!("whisper spawn error: {e}");
            Response { status: 500, body: serde_json::json!({ "error": "whisper not found", "detail": e.to_string() }).to_string().into(), ..Default::default() }
        }
    }
}

#[get("/transcriptions/:id")]
pub async fn get_transcription(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }
    let id   = req.params.get("id").cloned().unwrap_or_default();
    let conn = state.db.lock().unwrap();
    match conn.query_row(
        "SELECT id,job_id,text FROM transcriptions WHERE id=?1",
        params![id],
        |r| Ok(serde_json::json!({ "id": r.get::<_,String>(0)?, "job_id": r.get::<_,String>(1)?, "text": r.get::<_,String>(2)? })),
    ) {
        Ok(v)  => Response { status: 200, body: v.to_string().into(), ..Default::default() },
        Err(_) => Response { status: 404, body: r#"{"error":"not found"}"#.into(), ..Default::default() },
    }
}
