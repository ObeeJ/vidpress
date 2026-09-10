use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;

use rusqlite::Connection;
use tempfile::TempDir;

use theflate::db::init_db;
use theflate::jobs::compress;
use theflate::media::detect::detect;
use theflate::state::{Db, HwEncoder, JobStore};

static ENV_MUTEX: Mutex<()> = Mutex::new(());

fn make_sample_video() -> tempfile::NamedTempFile {
    let f = tempfile::Builder::new().suffix(".mp4").tempfile().expect("tempfile");
    let status = Command::new("ffmpeg")
        .args([
            "-y", "-f", "lavfi", "-i", "testsrc=d=3:s=640x480:r=30",
            "-c:v", "libx264", "-t", "3", f.path().to_str().unwrap(),
        ])
        .status().expect("ffmpeg command failed");
    assert!(status.success(), "failed to generate sample video fixture");
    f
}

#[tokio::test]
async fn test_target_mb_two_pass_real_encode_and_log_cleanup() {
    let _guard = ENV_MUTEX.lock().unwrap();
    std::env::remove_var("THEFLATE_CODEC");

    let tmp = TempDir::new().expect("tempdir");
    let stor = tmp.path().join("storage");
    std::fs::create_dir_all(&stor).ok();
    std::env::set_var("THEFLATE_STORAGE", stor.to_str().unwrap());

    let conn = Connection::open_in_memory().expect("in-memory db");
    init_db(&conn);
    let db: Db = Arc::new(Mutex::new(conn));
    let jobs: JobStore = Arc::new(Mutex::new(HashMap::new()));
    let sem = Arc::new(Semaphore::new(10));

    let fixture = make_sample_video();
    let input_path = fixture.path().to_str().unwrap().to_string();
    let output_path = tmp.path().join("out_target.mp4").to_str().unwrap().to_string();

    let profile = detect(&input_path).await.expect("detect profile");
    let job_id = "test-job-two-pass-1".to_string();

    let job = theflate::jobs::model::Job {
        id: job_id.clone(),
        status: theflate::jobs::model::JobStatus::Queued,
        media_kind: profile.kind.clone(),
        input_path: input_path.clone(),
        output_path: output_path.clone(),
        original_bytes: profile.size_bytes,
        compressed_bytes: 0,
        duration_secs: profile.duration_secs,
        progress: 0,
        eta_secs: profile.estimated_time_secs * 2,
        webhook_url: None,
        preset: None,
        destination: None,
        remote_url: None,
        owner_key: None,
    };
    jobs.lock().unwrap().insert(job_id.clone(), job);

    let target_mb = 0.5;

    compress::run(
        job_id.clone(),
        input_path.clone(),
        output_path.clone(),
        profile.clone(),
        None,
        Some(target_mb),
        jobs.clone(),
        db.clone(),
        HwEncoder::Software,
        sem,
    ).await;

    // 1. Assert output file exists
    assert!(
        std::path::Path::new(&output_path).exists(),
        "Output file must exist after two-pass encoding"
    );

    // 2. Assert output file size is near target size
    let out_len = std::fs::metadata(&output_path).unwrap().len();
    assert!(out_len > 10_000, "Output file should not be tiny/empty; got {out_len} bytes");
    let out_mb = out_len as f64 / 1_048_576.0;
    assert!(
        out_mb <= 1.0 && out_mb >= 0.05,
        "Output size {out_mb} MB should be near target {target_mb} MB"
    );

    // 3. Assert pass-1 and pass-2 log files got cleaned up
    let prefix = format!("{job_id}_passlog");
    let log_files_exist = std::fs::read_dir(&stor)
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().starts_with(&prefix));
    assert!(
        !log_files_exist,
        "Pass log files starting with {prefix} should be cleaned up after encode"
    );

    // 4. Assert video codec (libx265 default produces HEVC stream)
    let probe_out = std::process::Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_streams", &output_path])
        .output()
        .expect("ffprobe");
    let probe_json: serde_json::Value = serde_json::from_slice(&probe_out.stdout).unwrap();
    let video_stream = probe_json["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == "video")
        .unwrap();
    let codec_name = video_stream["codec_name"].as_str().unwrap();
    assert_eq!(
        codec_name, "hevc",
        "Default two-pass codec should be HEVC (libx265); got {codec_name}"
    );
}

#[tokio::test]
async fn test_target_mb_codec_env_var_override() {
    let _guard = ENV_MUTEX.lock().unwrap();

    let tmp = TempDir::new().expect("tempdir");
    let stor = tmp.path().join("storage_h264");
    std::fs::create_dir_all(&stor).ok();
    std::env::set_var("THEFLATE_STORAGE", stor.to_str().unwrap());
    std::env::set_var("THEFLATE_CODEC", "h264");

    let conn = Connection::open_in_memory().expect("in-memory db");
    init_db(&conn);
    let db: Db = Arc::new(Mutex::new(conn));
    let jobs: JobStore = Arc::new(Mutex::new(HashMap::new()));
    let sem = Arc::new(Semaphore::new(10));

    let fixture = make_sample_video();
    let input_path = fixture.path().to_str().unwrap().to_string();
    let output_path = tmp.path().join("out_h264.mp4").to_str().unwrap().to_string();

    let profile = detect(&input_path).await.expect("detect profile");
    let job_id = "test-job-two-pass-h264".to_string();

    compress::run(
        job_id.clone(),
        input_path.clone(),
        output_path.clone(),
        profile.clone(),
        None,
        Some(0.5),
        jobs.clone(),
        db.clone(),
        HwEncoder::Software,
        sem,
    ).await;

    std::env::remove_var("THEFLATE_CODEC");

    let probe_out = std::process::Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_streams", &output_path])
        .output()
        .expect("ffprobe");
    let probe_json: serde_json::Value = serde_json::from_slice(&probe_out.stdout).unwrap();
    let video_stream = probe_json["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["codec_type"] == "video")
        .unwrap();
    let codec_name = video_stream["codec_name"].as_str().unwrap();
    assert_eq!(
        codec_name, "h264",
        "THEFLATE_CODEC=h264 should result in h264 output; got {codec_name}"
    );
}
