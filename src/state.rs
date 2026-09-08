use std::{collections::HashMap, sync::{Arc, Mutex}};
use rusqlite::Connection;
use crate::jobs::model::Job;

pub type Db = Arc<Mutex<Connection>>;
pub type JobStore = Arc<Mutex<HashMap<String, Job>>>;

#[derive(Clone)]
pub struct AppState {
    pub jobs: JobStore,
    pub db: Db,
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

pub const ALLOWED_EXTS: &[&str] = &[
    "mp4", "mov", "mkv", "avi", "webm",
    "mp3", "wav", "flac", "m4a", "ogg", "aac", "opus", "aiff", "aif",
    "jpg", "jpeg", "png", "webp", "gif",
];
