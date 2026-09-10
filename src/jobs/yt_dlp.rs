use tokio::process::Command;
use crate::{
    db::upsert_job,
    jobs::{compress::set_status, model::JobStatus},
    state::{Db, JobStore},
    webhook,
};

pub async fn run(
    id: String, url: String, output: String,
    audio_only: bool, jobs: JobStore, db: Db,
) {
    // LOCK ORDER INVARIANT: jobs before db. Mutate and clone in one lock
    // acquisition so the DB is never behind the in-memory state.
    let snapshot = {
        let mut store = jobs.lock().unwrap();
        if let Some(job) = store.get_mut(&id) { job.status = JobStatus::Processing; }
        store.get(&id).cloned()
    };
    if let Some(snap) = snapshot { upsert_job(&db, &snap); }

    let mut args = vec![
        "--no-playlist".to_string(),
        "-o".to_string(), output.clone(),
        "--max-filesize".to_string(), "4G".to_string(),
        "--concurrent-fragments".to_string(), "8".to_string(),
    ];
    if audio_only {
        args.extend(["--extract-audio".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "0".into()]);
    } else {
        args.extend([
            "-f".into(), "bestvideo[height<=2160]+bestaudio/bestvideo+bestaudio/best".into(),
            "--merge-output-format".into(), "mp4".into(),
        ]);
    }
    args.push(url);

    match Command::new("yt-dlp").args(&args).kill_on_drop(true).output().await {
        Ok(o) if o.status.success() => {
            let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
            // LOCK ORDER INVARIANT: always acquire `jobs` before `db`.
            // Clone the job and drop `jobs` before calling upsert_job.
            let job_clone = {
                let mut store = jobs.lock().unwrap();
                if let Some(job) = store.get_mut(&id) {
                    job.status = JobStatus::Done;
                    job.compressed_bytes = size;
                    job.original_bytes = size;
                    job.progress = 100;
                }
                store.get(&id).cloned()
            };
            if let Some(job_clone) = job_clone {
                upsert_job(&db, &job_clone);
                if let Some(ref dest) = job_clone.destination {
                    let output_path = job_clone.output_path.clone();
                    let dest = dest.clone();
                    let job_id = job_clone.id.clone();
                    let db2 = db.clone();
                    let jobs2 = jobs.clone();
                    tokio::spawn(async move {
                        match crate::export::s3::upload(&dest, &output_path).await {
                            Ok(url) => {
                                // LOCK ORDER INVARIANT: jobs before db.
                                let updated = {
                                    let mut s = jobs2.lock().unwrap();
                                    if let Some(j) = s.get_mut(&job_id) {
                                        j.remote_url = Some(url);
                                        Some(j.clone())
                                    } else { None }
                                };
                                if let Some(j) = updated { upsert_job(&db2, &j); }
                            }
                            Err(e) => tracing::error!("auto-export failed for {job_id}: {e}"),
                        }
                    });
                }
                if let Some(url) = job_clone.webhook_url.clone() {
                    let payload = serde_json::to_string(&job_clone.public()).unwrap_or_default();
                    tokio::spawn(async move { webhook::deliver(&url, &payload).await; });
                }
                jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            }
        }
        Ok(o) => {
            tracing::error!("yt-dlp failed: {}", String::from_utf8_lossy(&o.stderr));
            set_status(&jobs, &id, JobStatus::Failed);
            if let Some(j) = jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
                upsert_job(&db, &j);
            }
        }
        Err(e) => {
            tracing::error!("yt-dlp spawn failed: {e}");
            set_status(&jobs, &id, JobStatus::Failed);
            jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        }
    }
}
