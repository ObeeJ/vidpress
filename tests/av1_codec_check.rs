use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;
use rusqlite::Connection;
use tempfile::TempDir;

use theflate::db::init_db;
use theflate::jobs::compress;
use theflate::media::detect::detect;
use theflate::state::{Db, HwEncoder, JobStore};

#[tokio::test]
async fn test_target_mb_av1_codec_real_encode() {
    std::env::set_var("THEFLATE_CODEC", "av1");

    let tmp = TempDir::new().expect("tempdir");
    let stor = tmp.path().join("storage_av1");
    std::fs::create_dir_all(&stor).ok();
    std::env::set_var("THEFLATE_STORAGE", stor.to_str().unwrap());

    let conn = Connection::open_in_memory().expect("in-memory db");
    init_db(&conn);
    let db: Db = Arc::new(Mutex::new(conn));
    let jobs: JobStore = Arc::new(Mutex::new(HashMap::new()));
    let sem = Arc::new(Semaphore::new(4));

    let f = tempfile::Builder::new().suffix(".mp4").tempfile().expect("tempfile");
    let status = std::process::Command::new("ffmpeg")
        .args(["-y", "-f", "lavfi", "-i", "testsrc=d=3:s=640x480:r=30",
               "-c:v", "libx264", "-t", "3", f.path().to_str().unwrap()])
        .status().expect("ffmpeg fixture gen");
    assert!(status.success());

    let input_path = f.path().to_str().unwrap().to_string();
    let output_path = tmp.path().join("out_av1.mp4").to_str().unwrap().to_string();
    let profile = detect(&input_path).await.expect("detect profile");
    let job_id = "test-job-av1".to_string();

    compress::run(
        job_id.clone(), input_path, output_path.clone(), profile, None, Some(0.5),
        jobs, db, HwEncoder::Software, sem,
    ).await;

    std::env::remove_var("THEFLATE_CODEC");

    assert!(std::path::Path::new(&output_path).exists(), "AV1 output file must exist");

    let probe = std::process::Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_streams", &output_path])
        .output().expect("ffprobe");
    let json: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
    let video = json["streams"].as_array().unwrap().iter().find(|s| s["codec_type"] == "video").unwrap();
    let codec_name = video["codec_name"].as_str().unwrap();
    assert_eq!(codec_name, "av1", "THEFLATE_CODEC=av1 should produce an AV1 stream; got {codec_name}");
}
