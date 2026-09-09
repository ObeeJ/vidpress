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
    set_status(&jobs, &id, JobStatus::Processing);
    upsert_job(&db, &jobs.lock().unwrap().get(&id).unwrap().clone());

    let mut args = vec!["--no-playlist".to_string(), "-o".to_string(), output.clone(),
        "--max-filesize".to_string(), "4G".to_string()];
    if audio_only {
        args.extend(["--extract-audio".into(), "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "0".into()]);
    } else {
        args.extend(["-f".into(), "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".into()]);
    }
    args.push(url);

    match Command::new("yt-dlp").args(&args).output().await {
        Ok(o) if o.status.success() => {
            let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
            let mut store = jobs.lock().unwrap();
            if let Some(job) = store.get_mut(&id) {
                job.status = JobStatus::Done;
                job.compressed_bytes = size;
                job.original_bytes = size;
                job.progress = 100;
                if let Some(ref dest) = job.destination.clone() {
                    let output_path = job.output_path.clone();
                    let dest = dest.clone();
                    let job_id = job.id.clone();
                    let db2 = db.clone();
                    let jobs2 = jobs.clone();
                    tokio::spawn(async move {
                        match crate::export::s3::upload(&dest, &output_path).await {
                            Ok(url) => {
                                if let Some(j) = jobs2.lock().unwrap().get_mut(&job_id) {
                                    j.remote_url = Some(url);
                                    upsert_job(&db2, j);
                                }
                            }
                            Err(e) => tracing::error!("auto-export failed for {job_id}: {e}"),
                        }
                    });
                }
                let job_clone = job.clone();
                drop(store);
                upsert_job(&db, &job_clone);
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
