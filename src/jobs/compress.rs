use std::time::Duration;
use tokio::process::Command;
use crate::{
    db::upsert_job,
    jobs::model::JobStatus,
    media::detect::MediaProfile,
    media::ffmpeg_args::preset_ffmpeg_args,
    state::{Db, HwEncoder, JobStore},
    webhook,
};

fn num_cpus() -> String {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).to_string()
}

pub async fn run(
    id: String, input: String, output: String,
    profile: MediaProfile, preset: Option<String>, target_mb: Option<f64>,
    jobs: JobStore, db: Db, hw: HwEncoder,
    sem: std::sync::Arc<tokio::sync::Semaphore>,
) {
    let _permit = sem.acquire_owned().await;
    let update = |status: JobStatus, progress: u8, eta: u64, compressed: u64| {
        let mut store = jobs.lock().unwrap();
        if let Some(job) = store.get_mut(&id) {
            job.status = status;
            job.progress = progress;
            job.eta_secs = eta;
            job.compressed_bytes = compressed;
        }
        if let Some(job) = store.get(&id).cloned() {
            drop(store);
            upsert_job(&db, &job);
        }
    };

    update(JobStatus::Processing, 0, profile.estimated_time_secs, 0);

    let progress_file = format!("{}/{id}_progress", crate::state::storage_dir());
    let duration = profile.duration_secs;
    let ffmpeg_args = if let Some(mb) = target_mb.filter(|_| preset.is_none()) {
        // Cap target_mb to prevent absurd bitrates that fill the disk. (M11)
        const MAX_TARGET_MB: f64 = 10_240.0;
        let mb = mb.clamp(0.1, MAX_TARGET_MB);
        // Convert target MB to a video bitrate, reserving 128k for audio
        let total_kbps = ((mb * 8.0 * 1024.0) / profile.duration_secs.max(1.0)) as u64;
        let video_kbps = total_kbps.saturating_sub(128).max(100);
        match &hw {
            HwEncoder::Nvenc => vec![
                "-c:v".into(), "h264_nvenc".into(), "-preset".into(), "p1".into(),
                "-b:v".into(), format!("{video_kbps}k"),
                "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                "-movflags".into(), "+faststart".into(),
            ],
            HwEncoder::Vaapi => vec![
                "-vaapi_device".into(), "/dev/dri/renderD128".into(),
                "-vf".into(), "format=nv12,hwupload".into(),
                "-c:v".into(), "h264_vaapi".into(),
                "-b:v".into(), format!("{video_kbps}k"),
                "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                "-movflags".into(), "+faststart".into(),
            ],
            HwEncoder::Software => vec![
                "-c:v".into(), "libx264".into(), "-preset".into(), "ultrafast".into(),
                "-b:v".into(), format!("{video_kbps}k"),
                "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                "-movflags".into(), "+faststart".into(),
            ],
        }
    } else {
        preset_ffmpeg_args(&preset, &hw).unwrap_or(profile.ffmpeg_args.clone())
    };

    let mut args: Vec<String> = vec!["-y".into(), "-threads".into(), num_cpus(), "-i".into(), input];
    args.extend(ffmpeg_args);
    if duration > 0.1 {
        args.extend(["-progress".into(), progress_file.clone(), "-nostats".into()]);
    }
    args.push(output.clone());

    let child = match Command::new("ffmpeg").args(&args)
        .env("OMP_NUM_THREADS", num_cpus())
        .stderr(std::process::Stdio::piped()).spawn()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("ffmpeg spawn failed: {e}");
            update(JobStatus::Failed, 0, 0, 0);
            return;
        }
    };

    // Progress polling task
    let jobs_p = jobs.clone();
    let db_p = db.clone();
    let id_p = id.clone();
    let pf = progress_file.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(content) = tokio::fs::read_to_string(&pf).await {
                if let Some(us) = parse_out_time_us(&content) {
                    let elapsed = us as f64 / 1_000_000.0;
                    let pct = ((elapsed / duration) * 100.0).min(99.0) as u8;
                    let eta = if pct > 0 {
                        ((elapsed / (pct as f64 / 100.0)) - elapsed) as u64
                    } else { 0 };
                    let mut s = jobs_p.lock().unwrap();
                    if let Some(job) = s.get_mut(&id_p) {
                        job.progress = pct;
                        job.eta_secs = eta;
                        let job_clone = job.clone();
                        drop(s);
                        upsert_job(&db_p, &job_clone);
                    }
                }
            }
        }
    });

    let result = child.wait_with_output().await;
    progress_task.abort();
    let _ = tokio::fs::remove_file(&progress_file).await;

    match result {
        Ok(out) if out.status.success() => {
            let compressed_bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
            let mut store = jobs.lock().unwrap();
            if let Some(job) = store.get_mut(&id) {
                job.status = JobStatus::Done;
                job.compressed_bytes = compressed_bytes;
                job.progress = 100;
                job.eta_secs = 0;
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
                // Evict from the in-memory cache — the job is terminal and the
                // DB is now the source of truth. Without this the HashMap grows
                // without bound on a busy server. (M6)
                jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            }
        }
        _ => {
            if let Ok(ref out) = result {
                tracing::error!("ffmpeg failed:\n{}", String::from_utf8_lossy(&out.stderr));
            }
            update(JobStatus::Failed, 0, 0, 0);
            jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        }
    }
}

pub fn set_status(jobs: &JobStore, id: &str, status: JobStatus) {
    if let Some(job) = jobs.lock().unwrap().get_mut(id) {
        job.status = status;
    }
}

fn parse_out_time_us(content: &str) -> Option<u64> {
    for line in content.lines() {
        if line.starts_with("out_time_us=") {
            return line["out_time_us=".len()..].trim().parse().ok();
        }
    }
    None
}
