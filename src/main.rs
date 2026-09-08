mod auth;
mod db;
mod jobs;
mod media;
mod handlers;
mod state;
mod webhook;

use std::{collections::HashMap, sync::{Arc, Mutex}, time::Duration};
use glideapi::{App, Config};
use rusqlite::Connection;
use state::{AppState, cors_origin, db_path};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let conn = Connection::open(db_path()).expect("cannot open db");
    db::init_db(&conn);

    // Reload jobs from DB into memory on startup
    let jobs_map: HashMap<_, _> = db::load_all_jobs(&conn)
        .into_iter()
        .map(|j| (j.id.clone(), j))
        .collect();

    let state = AppState {
        jobs: Arc::new(Mutex::new(jobs_map)),
        db:   Arc::new(Mutex::new(conn)),
    };

    let origin = cors_origin();
    tracing::info!("CORS origin: {origin}");

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
