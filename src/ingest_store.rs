//! Opaque handles for uploaded files.
//!
//! The client never learns a filesystem path and can never supply one. It
//! receives an `ingest_id` from `POST /ingest` and redeems it at `/analyze`
//! and `/upload`. The server owns the mapping, so "point ffmpeg at
//! /etc/passwd" and "point ffmpeg at http://169.254.169.254/" both become
//! unrepresentable rather than merely filtered.

use rusqlite::{params, OptionalExtension};
use crate::state::Db;

/// Ingested files stop being redeemable after this long. Matches the 2h sweep
/// in cleanup.sh so an id never outlives the bytes it points at.
pub const INGEST_TTL_SECS: i64 = 7200;

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Register a freshly written upload. `owner` is the API key that uploaded it,
/// or `None` for an anonymous upload.
pub fn record(db: &Db, id: &str, path: &str, owner: Option<&str>) -> rusqlite::Result<()> {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT INTO ingests(id, path, owner_key, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, path, owner, now()],
    )?;
    Ok(())
}

/// Redeem an id. Returns the path only when the id exists, is unexpired, and
/// the caller owns it. Ownership is exact-match: an anonymous caller cannot
/// read a key-owned ingest, and a key holder cannot read an anonymous one.
/// Every failure mode returns `None`, so this is not an existence oracle.
pub fn resolve(db: &Db, id: &str, caller: Option<&str>) -> Option<String> {
    if id.is_empty() { return None; }
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    let row: Option<(String, Option<String>, i64)> = conn.query_row(
        "SELECT path, owner_key, created_at FROM ingests WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).optional().ok().flatten();

    let (path, owner, created) = row?;
    if now() - created > INGEST_TTL_SECS { return None; }
    if owner.as_deref() != caller { return None; }
    Some(path)
}

/// Drop expired rows. Returns how many were removed. Called from cleanup.sh.
pub fn purge_expired(db: &Db) -> usize {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute("DELETE FROM ingests WHERE created_at < ?1", params![now() - INGEST_TTL_SECS])
        .unwrap_or(0)
}
