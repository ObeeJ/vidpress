use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;
use tokio::process::Command;
use crate::{
    db::upsert_job,
    jobs::model::JobStatus,
    media::detect::{MediaKind, MediaProfile},
    media::ffmpeg_args::preset_ffmpeg_args,
    state::{Db, HwEncoder, JobStore},
    webhook,
};

fn num_cpus() -> String {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).to_string()
}

/// Codec name plus its own `-preset` value - x264/x265 use named presets
/// ("medium"), SVT-AV1 uses a numeric one (0=slowest/best..13=fastest; 6 is
/// AV1's own documented balance point, distinct from x264/x265's "medium").
fn target_mb_codec() -> (&'static str, &'static str) {
    match std::env::var("THEFLATE_CODEC").as_deref() {
        Ok("h264") | Ok("libx264") => ("libx264", "medium"),
        Ok("av1") | Ok("libsvtav1") => ("libsvtav1", "6"),
        _ => ("libx265", "medium"),
    }
}

async fn cleanup_passlog_files(id: &str) {
    let dir = crate::state::storage_dir();
    let prefix = format!("{id}_passlog");
    if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with(&prefix) {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }
        }
    }
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

    let is_two_pass = target_mb.filter(|_| preset.is_none()).is_some()
        && (profile.kind == MediaKind::Video || profile.kind == MediaKind::ImageAnimated)
        && hw != HwEncoder::Nvenc;

    let initial_eta = if is_two_pass {
        profile.estimated_time_secs * 2
    } else {
        profile.estimated_time_secs
    };

    update(JobStatus::Processing, 0, initial_eta, 0);

    let progress_file = format!("{}/{id}_progress", crate::state::storage_dir());
    let duration = profile.duration_secs;
    let current_pass = std::sync::Arc::new(AtomicU8::new(1));

    // Progress polling task
    let jobs_p = jobs.clone();
    let db_p = db.clone();
    let id_p = id.clone();
    let pf = progress_file.clone();
    let current_pass_task = current_pass.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if let Ok(content) = tokio::fs::read_to_string(&pf).await {
                if let Some(us) = parse_out_time_us(&content) {
                    let elapsed = us as f64 / 1_000_000.0;
                    let pass = current_pass_task.load(Ordering::Relaxed);
                    let (pct, eta) = if is_two_pass {
                        if pass == 1 {
                            let p = ((elapsed / duration.max(0.1)) * 50.0).min(49.0) as u8;
                            let rem = (2.0 * duration - elapsed).max(0.0) as u64;
                            (p, rem)
                        } else {
                            let p = (50.0 + (elapsed / duration.max(0.1)) * 50.0).min(99.0) as u8;
                            let rem = (duration - elapsed).max(0.0) as u64;
                            (p, rem)
                        }
                    } else {
                        let p = ((elapsed / duration.max(0.1)) * 100.0).min(99.0) as u8;
                        let rem = if p > 0 {
                            ((elapsed / (p as f64 / 100.0)) - elapsed) as u64
                        } else { 0 };
                        (p, rem)
                    };
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

    let result = if is_two_pass {
        let mb = target_mb.unwrap();
        const MAX_TARGET_MB: f64 = 10_240.0;
        let mb = mb.clamp(0.1, MAX_TARGET_MB);
        let total_kbps = ((mb * 8.0 * 1024.0) / profile.duration_secs.max(1.0)) as u64;
        let video_kbps = total_kbps.saturating_sub(128).max(100);

        const MIN_BITS_PER_PIXEL: f64 = 0.02;
        const ASSUMED_FPS: f64 = 30.0;
        let scale_filter = match (profile.width, profile.height) {
            (Some(w), Some(h)) if w > 0 && h > 0 => {
                let bits_per_pixel = (video_kbps as f64 * 1000.0) / (w as f64 * h as f64 * ASSUMED_FPS);
                if bits_per_pixel < MIN_BITS_PER_PIXEL {
                    let scale_factor = (bits_per_pixel / MIN_BITS_PER_PIXEL).sqrt();
                    let target_h = ((h as f64 * scale_factor) as u64).clamp(144, h).next_multiple_of(2);
                    Some(format!("scale=-2:{target_h}"))
                } else {
                    None
                }
            }
            _ => None,
        };

        let (codec, codec_preset) = target_mb_codec();
        let passlogfile = format!("{}/{id}_passlog", crate::state::storage_dir());
        let null_output = if cfg!(windows) { "NUL" } else { "/dev/null" };

        let mut pass1_args: Vec<String> = vec![
            "-y".into(), "-threads".into(), num_cpus(), "-i".into(), input.clone(),
            "-c:v".into(), codec.into(), "-preset".into(), codec_preset.into(),
            "-b:v".into(), format!("{video_kbps}k"),
        ];
        if let Some(ref f) = scale_filter {
            pass1_args.push("-vf".into());
            pass1_args.push(f.clone());
        }
        pass1_args.extend([
            "-pass".into(), "1".into(), "-passlogfile".into(), passlogfile.clone(),
        ]);
        if duration > 0.1 {
            pass1_args.extend(["-progress".into(), progress_file.clone(), "-nostats".into()]);
        }
        pass1_args.extend(["-an".into(), "-f".into(), "null".into(), null_output.into()]);

        current_pass.store(1, Ordering::Relaxed);
        let child1 = Command::new("ffmpeg").args(&pass1_args)
            .env("OMP_NUM_THREADS", num_cpus())
            .stderr(std::process::Stdio::piped()).spawn();

        let res1 = match child1 {
            Ok(c) => c.wait_with_output().await,
            Err(e) => {
                tracing::error!("ffmpeg pass 1 spawn failed: {e}");
                progress_task.abort();
                let _ = tokio::fs::remove_file(&progress_file).await;
                cleanup_passlog_files(&id).await;
                update(JobStatus::Failed, 0, 0, 0);
                jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                return;
            }
        };

        if let Ok(ref out) = res1 {
            if !out.status.success() {
                tracing::error!("ffmpeg pass 1 failed:\n{}", String::from_utf8_lossy(&out.stderr));
                progress_task.abort();
                let _ = tokio::fs::remove_file(&progress_file).await;
                cleanup_passlog_files(&id).await;
                update(JobStatus::Failed, 0, 0, 0);
                jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                return;
            }
        } else if let Err(ref e) = res1 {
            tracing::error!("ffmpeg pass 1 wait failed: {e}");
            progress_task.abort();
            let _ = tokio::fs::remove_file(&progress_file).await;
            cleanup_passlog_files(&id).await;
            update(JobStatus::Failed, 0, 0, 0);
            jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            return;
        }

        // Clean up pass 1 progress file before starting pass 2
        let _ = tokio::fs::remove_file(&progress_file).await;

        let mut pass2_args: Vec<String> = vec![
            "-y".into(), "-threads".into(), num_cpus(), "-i".into(), input.clone(),
            "-c:v".into(), codec.into(), "-preset".into(), codec_preset.into(),
            "-b:v".into(), format!("{video_kbps}k"),
        ];
        if let Some(ref f) = scale_filter {
            pass2_args.push("-vf".into());
            pass2_args.push(f.clone());
        }
        pass2_args.extend([
            "-pass".into(), "2".into(), "-passlogfile".into(), passlogfile.clone(),
            "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
            "-movflags".into(), "+faststart".into(),
        ]);
        if duration > 0.1 {
            pass2_args.extend(["-progress".into(), progress_file.clone(), "-nostats".into()]);
        }
        pass2_args.push(output.clone());

        current_pass.store(2, Ordering::Relaxed);
        let child2 = Command::new("ffmpeg").args(&pass2_args)
            .env("OMP_NUM_THREADS", num_cpus())
            .stderr(std::process::Stdio::piped()).spawn();

        match child2 {
            Ok(c) => c.wait_with_output().await,
            Err(e) => {
                tracing::error!("ffmpeg pass 2 spawn failed: {e}");
                progress_task.abort();
                let _ = tokio::fs::remove_file(&progress_file).await;
                cleanup_passlog_files(&id).await;
                update(JobStatus::Failed, 0, 0, 0);
                jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                return;
            }
        }
    } else {
        // Single pass path (audio, preset video, default video, NVENC target_mb)
        let ffmpeg_args = if profile.kind == MediaKind::AudioLossy || profile.kind == MediaKind::AudioLossless {
            if let Some(mb) = target_mb {
                let audio_kbps = (((mb * 8.0 * 1024.0) / profile.duration_secs.max(1.0)) as u64).clamp(32, 320);
                vec!["-c:a".into(), "aac".into(), "-b:a".into(), format!("{audio_kbps}k"), "-vn".into()]
            } else {
                profile.ffmpeg_args.clone()
            }
        } else if let Some(mb) = target_mb.filter(|_| preset.is_none()) {
            const MAX_TARGET_MB: f64 = 10_240.0;
            let mb = mb.clamp(0.1, MAX_TARGET_MB);
            let total_kbps = ((mb * 8.0 * 1024.0) / profile.duration_secs.max(1.0)) as u64;
            let video_kbps = total_kbps.saturating_sub(128).max(100);

            const MIN_BITS_PER_PIXEL: f64 = 0.02;
            const ASSUMED_FPS: f64 = 30.0;
            let scale_filter = match (profile.width, profile.height) {
                (Some(w), Some(h)) if w > 0 && h > 0 => {
                    let bits_per_pixel = (video_kbps as f64 * 1000.0) / (w as f64 * h as f64 * ASSUMED_FPS);
                    if bits_per_pixel < MIN_BITS_PER_PIXEL {
                        let scale_factor = (bits_per_pixel / MIN_BITS_PER_PIXEL).sqrt();
                        let target_h = ((h as f64 * scale_factor) as u64).clamp(144, h).next_multiple_of(2);
                        Some(format!("scale=-2:{target_h}"))
                    } else {
                        None
                    }
                }
                _ => None,
            };
            let with_scale = |mut args: Vec<String>| {
                if let Some(ref f) = scale_filter {
                    args.push("-vf".into());
                    args.push(f.clone());
                }
                args
            };

            match &hw {
                HwEncoder::Nvenc => with_scale(vec![
                    "-c:v".into(), "h264_nvenc".into(), "-preset".into(), "p1".into(),
                    "-b:v".into(), format!("{video_kbps}k"),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                    "-movflags".into(), "+faststart".into(),
                ]),
                // Reached by MediaKind::ImageStatic target_mb jobs, which
                // is_two_pass excludes (two-pass only applies to Video and
                // ImageAnimated). Vaapi and Software fall back to the same
                // single-pass ultrafast libx264 encode used before two-pass
                // existed, rather than panicking.
                HwEncoder::Vaapi | HwEncoder::Software => with_scale(vec![
                    "-c:v".into(), "libx264".into(), "-preset".into(), "ultrafast".into(),
                    "-b:v".into(), format!("{video_kbps}k"),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                    "-movflags".into(), "+faststart".into(),
                ]),
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

        child.wait_with_output().await
    };

    progress_task.abort();
    let _ = tokio::fs::remove_file(&progress_file).await;
    if is_two_pass {
        cleanup_passlog_files(&id).await;
    }

    match result {
        Ok(out) if out.status.success() => {
            let compressed_bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
            // LOCK ORDER INVARIANT: always acquire `jobs` before `db`.
            // Clone the job and drop `jobs` before calling upsert_job (which
            // acquires `db`). Inverting this order anywhere would deadlock.
            let job_clone = {
                let mut store = jobs.lock().unwrap();
                if let Some(job) = store.get_mut(&id) {
                    job.status = JobStatus::Done;
                    job.compressed_bytes = compressed_bytes;
                    job.progress = 100;
                    job.eta_secs = 0;
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
                // Evict from the in-memory cache - the job is terminal and the
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
