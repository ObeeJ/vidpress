use std::{collections::HashMap, sync::{Arc, Mutex}};
use tokio::process::{Child, Command};
use crate::{
    db::upsert_job,
    jobs::model::{Job, JobStatus},
    media::detect::MediaKind,
    state::{Db, JobStore, storage_dir},
};

/// Active capture processes keyed by job_id.
pub type CaptureStore = Arc<Mutex<HashMap<String, Child>>>;

pub fn new_store() -> CaptureStore {
    Arc::new(Mutex::new(HashMap::new()))
}

pub async fn start(
    id: String,
    display: &str,
    fps: u8,
    resolution: &str,
    jobs: &JobStore,
    db: &Db,
    captures: &CaptureStore,
) -> Result<(), String> {
    let out_dir = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let output = format!("{}/{}_capture.mp4", out_dir, id);

    // x11grab → libx264 (VAAPI can't encode from x11grab directly without extra filter)
    let child = Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "x11grab",
            "-framerate", &fps.to_string(),
            "-video_size", resolution,
            "-i", display,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-movflags", "+faststart+frag_keyframe+empty_moov",
            &output,
        ])
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    let job = Job {
        id: id.clone(),
        status: JobStatus::Processing,
        media_kind: MediaKind::Video,
        input_path: display.to_string(),
        output_path: output,
        original_bytes: 0, compressed_bytes: 0,
        duration_secs: 0.0, progress: 0, eta_secs: 0,
        webhook_url: None, preset: None, destination: None, remote_url: None,
    };
    upsert_job(db, &job);
    jobs.lock().unwrap().insert(id.clone(), job);
    captures.lock().unwrap().insert(id, child);
    Ok(())
}

pub async fn stop(
    id: &str,
    jobs: &JobStore,
    db: &Db,
    captures: &CaptureStore,
) -> Result<String, String> {
    let mut child = captures.lock().unwrap().remove(id)
        .ok_or_else(|| "capture not found".to_string())?;

    // Send SIGINT so ffmpeg finalises the MP4 properly
    if let Some(pid) = child.id() {
        unsafe { libc::kill(pid as i32, libc::SIGINT); }
    }
    let _ = child.wait().await;

    let output_path = jobs.lock().unwrap()
        .get(id).map(|j| j.output_path.clone())
        .ok_or_else(|| "job not found".to_string())?;

    let size = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
    let mut store = jobs.lock().unwrap();
    if let Some(job) = store.get_mut(id) {
        job.status = JobStatus::Done;
        job.compressed_bytes = size;
        job.progress = 100;
        let job_clone = job.clone();
        drop(store);
        upsert_job(db, &job_clone);
    }
    Ok(output_path)
}
