mod auth;
mod db;
mod jobs;
mod media;
mod handlers;
mod state;
mod webhook;
mod ws;

use std::{collections::HashMap, sync::{Arc, Mutex}, time::Duration};
use glideapi::{App, Config};
use rusqlite::Connection;
use tokio::sync::Semaphore;
use state::{AppState, cors_origin, db_path, detect_hw};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let conn = Connection::open(db_path()).expect("cannot open db");
    db::init_db(&conn);

    let jobs_map: HashMap<_, _> = db::load_all_jobs(&conn)
        .into_iter()
        .map(|j| (j.id.clone(), j))
        .collect();

    let hw      = detect_hw().await;
    let max_jobs = std::env::var("THEFLATE_MAX_JOBS")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(4usize);

    let state = AppState {
        jobs:     Arc::new(Mutex::new(jobs_map)),
        db:       Arc::new(Mutex::new(conn)),
        hw,
        job_sem:  Arc::new(Semaphore::new(max_jobs)),
        captures: jobs::capture::new_store(),
        streams:  jobs::stream::new_store(),
    };

    let origin = cors_origin();
    tracing::info!("CORS origin: {origin}");

    // WebSocket live-stream server on :8081
    let ws_state = Arc::new(state.clone());
    tokio::spawn(async move { ws::listen(ws_state).await });

    App::new()
        .config(Config {
            body_limit:      2 * 1024 * 1024 * 1024,
            request_timeout: Duration::from_secs(600),
            cors_origin:     Some(origin),
        })
        .state(state)
        .mount_routes()
        .listen("0.0.0.0:8080")
        .await;
}
