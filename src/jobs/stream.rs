use std::{collections::HashMap, sync::{Arc, Mutex}};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use crate::{
    db::upsert_job,
    jobs::model::{Job, JobStatus},
    media::detect::MediaKind,
    state::{Db, JobStore, storage_dir},
};

pub struct StreamSession {
    pub child:  Child,
    pub stdin:  ChildStdin,
    pub output: String,
}

pub type StreamStore = Arc<Mutex<HashMap<String, String>>>;  // id → output_path

pub fn new_store() -> StreamStore {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Spawn ffmpeg reading from stdin (raw WebM/chunks from MediaRecorder).
/// Writes a fragmented MP4 so the preview endpoint can serve partial data.
pub fn start_session(id: &str) -> Result<StreamSession, String> {
    let out_dir = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let output = format!("{}/{}_stream.mp4", out_dir, id);

    let mut child = Command::new("ffmpeg")
        .args([
            "-y",
            "-fflags", "nobuffer",
            "-i", "pipe:0",                          // read from stdin
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-c:a", "aac", "-b:a", "128k",
            // fragmented MP4 — allows reading before EOF
            "-movflags", "+frag_keyframe+empty_moov+default_base_moof+faststart",
            "-f", "mp4",
            &output,
        ])
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    let stdin = child.stdin.take().ok_or("no stdin")?;
    Ok(StreamSession { child, stdin, output })
}

pub async fn write_chunk(stdin: &mut ChildStdin, data: &[u8]) -> Result<(), String> {
    stdin.write_all(data).await.map_err(|e| e.to_string())
}

pub async fn finish_session(
    id: String,
    mut session: StreamSession,
    jobs: &JobStore,
    db: &Db,
) {
    drop(session.stdin);  // close stdin -> ffmpeg EOF -> finalises file
    let exit_status = session.child.wait().await;
    let size = std::fs::metadata(&session.output).map(|m| m.len()).unwrap_or(0);
    let ok = matches!(exit_status, Ok(s) if s.success()) && size > 0;
    let job_status = if ok { JobStatus::Done } else { JobStatus::Failed };

    let job = Job {
        id: id.clone(),
        status: job_status,
        media_kind: MediaKind::Video,
        input_path: "ws://stream".into(),
        output_path: session.output.clone(),
        original_bytes: size, compressed_bytes: size,
        duration_secs: 0.0, progress: 100, eta_secs: 0,
        webhook_url: None, preset: None, destination: None, remote_url: None, owner_key: None,
    };
    upsert_job(db, &job);
    jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(id, job);
}
