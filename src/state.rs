use std::{collections::HashMap, sync::{Arc, Mutex}};
use rusqlite::Connection;
use tokio::sync::Semaphore;
use crate::jobs::model::Job;
use crate::jobs::capture::CaptureStore;
use crate::jobs::stream::StreamStore;

pub type Db       = Arc<Mutex<Connection>>;
pub type JobStore = Arc<Mutex<HashMap<String, Job>>>;

/// Hardware encoder available on this machine (detected once at startup).
#[derive(Debug, Clone, PartialEq)]
pub enum HwEncoder { Nvenc, Vaapi, Software }

#[derive(Clone)]
pub struct AppState {
    pub jobs:       JobStore,
    pub db:         Db,
    pub hw:         HwEncoder,
    /// Limits concurrent ffmpeg processes to avoid OOM / thrashing.
    pub job_sem:    Arc<Semaphore>,
    pub captures:   CaptureStore,
    pub streams:    StreamStore,
}

pub fn storage_dir() -> String {
    std::env::var("THEFLATE_STORAGE").unwrap_or_else(|_| "/tmp/theflate_output".into())
}

pub fn db_path() -> String {
    std::env::var("THEFLATE_DB").unwrap_or_else(|_| "/tmp/theflate.db".into())
}

pub fn cors_origin() -> String {
    std::env::var("THEFLATE_CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into())
}

/// Probe for best available hardware encoder: NVENC > VAAPI > Software.
pub async fn detect_hw() -> HwEncoder {
    // Try NVENC first (fastest)
    let nvenc = tokio::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1",
            "-c:v", "h264_nvenc", "-f", "null", "-"])
        .output().await;
    if matches!(nvenc, Ok(o) if o.status.success()) {
        tracing::info!("hardware encoder: h264_nvenc");
        return HwEncoder::Nvenc;
    }
    // Try VAAPI
    let vaapi = tokio::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error",
            "-vaapi_device", "/dev/dri/renderD128",
            "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1",
            "-vf", "format=nv12,hwupload",
            "-c:v", "h264_vaapi", "-f", "null", "-"])
        .output().await;
    if matches!(vaapi, Ok(o) if o.status.success()) {
        tracing::info!("hardware encoder: h264_vaapi");
        return HwEncoder::Vaapi;
    }
    tracing::info!("hardware encoder: software (libx264)");
    HwEncoder::Software
}

pub const ALLOWED_EXTS: &[&str] = &[
    "mp4", "mov", "mkv", "avi", "webm",
    "mp3", "wav", "flac", "m4a", "ogg", "aac", "opus", "aiff", "aif",
    "jpg", "jpeg", "png", "webp", "gif",
];
