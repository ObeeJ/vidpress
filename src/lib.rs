//! Library surface for the theflate service.
//!
//! `main.rs` is a thin binary that calls into this crate. The split exists so
//! `tests/` can import real types instead of re-implementing them — a
//! binary-only crate exports nothing to integration tests.

pub mod auth;
pub mod db;
pub mod export;
pub mod handlers;
pub mod ingest_store;
pub mod jobs;
pub mod media;
pub mod state;
pub mod webhook;
pub mod ws;
