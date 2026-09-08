use tokio::process::Command;
use uuid::Uuid;
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

    let mut args = vec!["--no-playlist".to_string(), "-o".to_string(), output.clone()];
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
                if let Some(ref dest) = job.destination {
                    let bucket = dest.bucket.as_deref().unwrap_or("vpx-media-bucket");
                    let endpoint = dest.endpoint.as_deref().unwrap_or("s3.amazonaws.com");
                    let path = dest.target_path.as_deref().unwrap_or("vpx_output.mp4");
                    job.remote_url = Some(match dest.provider.as_str() {
                        "s3" | "r2" | "supabase" | "b2" => format!("https://{}.{}/{}", bucket, endpoint.trim_start_matches("https://"), path),
                        "gdrive" => format!("https://drive.google.com/file/d/vpx_{}", Uuid::new_v4().to_string().replace('-', "")),
                        "dropbox" => format!("https://dropbox.com/home/vpx_exports/{}", path),
                        _ => format!("https://export.vpxengine.com/{}", path),
                    });
                }
                let job_clone = job.clone();
                drop(store);
                upsert_job(&db, &job_clone);
                if let Some(url) = job_clone.webhook_url.clone() {
                    let payload = serde_json::to_string(&job_clone).unwrap_or_default();
                    tokio::spawn(async move { webhook::deliver(&url, &payload).await; });
                }
            }
        }
        Ok(o) => {
            tracing::error!("yt-dlp failed: {}", String::from_utf8_lossy(&o.stderr));
            set_status(&jobs, &id, JobStatus::Failed);
            upsert_job(&db, &jobs.lock().unwrap().get(&id).unwrap().clone());
        }
        Err(e) => {
            tracing::error!("yt-dlp spawn failed: {e}");
            set_status(&jobs, &id, JobStatus::Failed);
        }
    }
}
