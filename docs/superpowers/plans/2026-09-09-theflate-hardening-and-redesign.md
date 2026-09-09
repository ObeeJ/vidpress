# theflate — Hardening, Contract Repair & Interface Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn theflate from a demo with a stubbed auth gate and three fabricated endpoints into a service where every advertised endpoint actually does what it claims, is authorised, is bounded, and is proven end-to-end by an automated test — behind an interface that reads as designed rather than generated.

**Architecture:** Four sequential phases, each independently shippable. Phase A makes the Rust crate testable and closes the exploitable holes. Phase B replaces fabricated behaviour (`/export`, webhook HMAC, `remote_url`) with real implementations and introduces resource ownership. Phase C rebuilds the frontend on the token system already landed in `ui/app/globals.css`. Phase D proves the whole thing with tests that drive a live server and a real browser. **Phase A must land before Phase B; Phase B before Task 3.4.**

**Tech Stack:** Rust 2021 · glideapi (local path dep at `../glideapi`; re-exports `ferox_macros` for `#[get]`/`#[post]`, uses `linkme` distributed slices for route auto-registration, exposes `Request`/`Response`/`State`/`Json`/`Path` extractors) · rusqlite 0.31 bundled · tokio 1 · reqwest 0.12 · Next.js 16.3.4 App Router · React 19.2.8 · Zustand 5 · Tailwind v4 (`@theme` tokens) · bun 1.3.14 · Playwright (added in Task 4.2).

**Spec:** This plan's spec is the audit recorded in `docs/superpowers/plans/2026-09-09-audit-findings.md` (Task 0.1 writes it). Finding IDs below (`C1`, `H7`, `M12`) refer to that document.

---

## Global Constraints

These apply to every task and are not restated per-task.

- **Rust edition 2021.** MSRV: whatever `../glideapi` requires; do not bump.
- **No new Rust dependencies** except: `hmac = "0.12"`, `sha2 = "0.10"`, `aws-sdk-s3 = "1"`, `aws-config = "1"`, `tempfile = "3"` (dev). Justify anything else in the PR body.
- **No new frontend runtime dependencies** except `@playwright/test` (devDependency). Motion is CSS-only — do **not** install framer-motion, GSAP, or react-spring. The token system in `ui/app/globals.css` is the motion layer.
- **Naming:** the product is `theflate`. Every new identifier, bucket default, URL and CSS class uses `theflate`, never `vpx`. Existing `.vpx-*` CSS classes are aliased now and removed in Task 3.2.
- **Copy rule:** the verb is **"compress"**. Not "deflate", not "theflate" as a verb, not "theflating". `theflate` is the brand noun only. The current UI mixes all three in a single viewport.
- **Every task ends green.** `cargo test` (backend) or `bun run build && bunx tsc --noEmit` (frontend) must pass before the commit step. Never commit red.
- **Secrets never reach a response body, a log line, or a webhook payload.** This is the invariant Phase B exists to protect.
- **New mutex acquisitions use `.lock().unwrap_or_else(|e| e.into_inner())`** (poison-tolerant). The existing `.unwrap()` calls make one panic anywhere a service-wide outage.

---

## The Contract Decision — read before Task 1.2

Three findings share one root cause. Fixing them separately produces an inconsistent API, so decide once, here:

**The server must never hand a client a filesystem path, and must never accept one back.**

Today: `POST /ingest` → returns `{"path":"/tmp/theflate_<uuid>.mp4"}` → browser stores it → `POST /upload {"path": "..."}`. The server therefore *has to* trust a client-supplied server path. That is finding **C3** (arbitrary file read + SSRF, because ffmpeg's `-i` resolves `http:`, `concat:`, `subfile:` and `data:` as protocols, not paths) and **C4** (arbitrary file write via `output_format`).

**New contract:**

| Old | New |
|---|---|
| `POST /ingest` → `{"path": "/tmp/..."}` | `POST /ingest` → `{"ingest_id": "<uuid>"}` |
| `POST /upload {"path": "/tmp/..."}` | `POST /upload {"ingest_id": "<uuid>"}` |
| `POST /analyze {"path": "/tmp/..."}` | `POST /analyze {"ingest_id": "<uuid>"}` |
| `POST /transcribe {"path": "..."}` | `POST /transcribe {"job_id": "..."}` only — the `path` branch is deleted |
| `GET /jobs/:id` → full `Job` incl. `output_path`, `destination.secret_key` | `GET /jobs/:id` → `PublicJob` (no paths, no credentials) |

The server resolves `ingest_id` → path from an `ingests` table it wrote itself. A client can no longer name a file the server did not create.

**Blast radius — four call sites break, all fixed in Task 2.1:**
1. `ui/lib/api.ts:13` reads `.path` from the ingest response.
2. `ui/lib/api.ts:37` sends `path` to `/upload`.
3. `ui/app/download/[id]/route.ts:21` reads `job.output_path` — **this route is deleted entirely** (finding H15: it is a second arbitrary-file-read, and it duplicates `GET /download/:id` on the Rust side).
4. `ui/lib/store.ts:9-10` declares `input_path` / `output_path` on the `Job` interface — removed.

---

## File Structure

**Rust — created:**

| File | Responsibility |
|---|---|
| `src/lib.rs` | Expose the crate as a library so `tests/` can import it. Currently binary-only, which is why zero integration tests exist. |
| `src/ingest_store.rs` | `ingest_id` ↔ path mapping with owner + expiry. Keystone of the new contract. |
| `src/webhook/sign.rs` | HMAC-SHA256 signing of webhook bodies (H2). |
| `src/export/s3.rs` | Real S3-compatible upload, replacing the fabricated URL (C7). |
| `tests/e2e_lifecycle.rs` | Integration tests against a real spawned server. |

*(`src/media/path_guard.rs` already exists and landed in a prior session.)*

**Rust — modified:** `src/main.rs`, `src/auth.rs`, `src/db.rs`, `src/state.rs`, `src/webhook.rs`, `src/ws.rs`, `src/jobs/{model,compress,yt_dlp,stream}.rs`, `src/handlers/{ingest,analyze,upload,jobs,transcribe,export,preview,download_url,keys}.rs`, `nginx.conf`, `cleanup.sh`, `Cargo.toml`.

**Rust — deleted:** `src/handlers/capture.rs`, `src/jobs/capture.rs` (C2 — unauthenticated X11 capture of the server's own display; no legitimate hosted use case).

**Frontend — created:**

| File | Responsibility |
|---|---|
| `ui/lib/format.ts` | Pure formatters: bytes → human, seconds → duration, ratio → percent. Used by every numeric display. |
| `ui/components/primitives/Button.tsx` | The single button. Replaces `.vpx-button-*` and the unused shadcn `ui/button.tsx`. |
| `ui/components/CountUp.tsx` | Animated numeric transition — the signature motion moment. |
| `ui/components/JobProgress.tsx` | Determinate + indeterminate progress, extracted from FileCard. |
| `ui/e2e/*.spec.ts`, `ui/playwright.config.ts` | Browser tests. |

**Frontend — modified:** `ui/lib/api.ts`, `ui/lib/store.ts`, `ui/app/page.tsx`, `ui/components/{DropZone,FileCard,Navbar,UrlDownloader,LiveStream,ScreenRecorder}.tsx`, `ui/package.json`, `README.md`.

**Frontend — deleted:** `ui/app/download/[id]/route.ts`, `ui/components/DeflationPipelineAnimation.tsx`, and `ui/components/ui/{button,badge,card,separator}.tsx` if unreferenced after Task 3.2.

---

# PHASE A — Make it testable, then close the holes

**Aim:** you cannot fix what you cannot test. Every Phase A task ends with a test that fails before the fix and passes after.

**Flow cycle:** `cargo test` is the loop. It must run in under 10 seconds. No Phase A task may depend on ffmpeg, network, or a real file on disk.

---

### Task 0.1: Record the audit as a spec

**Files:**
- Create: `docs/superpowers/plans/2026-09-09-audit-findings.md`

**Interfaces:**
- Produces: stable finding IDs (`C1`–`C8`, `H1`–`H15`, `M1`–`M15`) that every later task references.

**Why this exists:** later tasks say "closes C3". Without the spec written down, an executor three tasks deep cannot verify they closed the right thing, or know when the phase is done.

- [ ] **Step 1: Write the findings document**

A table with columns `ID | Severity | Title | Evidence (file:line) | Status`, every `Status` set to `OPEN`. Transcribe all 8 Critical, 15 High and 15 Medium findings from the audit. The Criticals, for reference:

| ID | Title | Evidence |
|---|---|---|
| C1 | `auth_and_rate` was a stub returning `Ok(None)` — all rate limits and plan gates dead | `src/auth.rs:69-71` |
| C2 | Unauthenticated x11grab capture of the server's display | `src/handlers/capture.rs:12`, `src/jobs/capture.rs:34-37` |
| C3 | Client-supplied `path` → arbitrary file read + SSRF via ffmpeg protocols | `src/handlers/upload.rs:21`, `analyze.rs:19`, `transcribe.rs:27`, `src/media/detect.rs:37` |
| C4 | `output_format` → arbitrary file write | `src/handlers/upload.rs:27,36,43`, `src/media/ffmpeg_args.rs:125` |
| C5 | S3 credentials leak via `GET /jobs/:id` and webhook bodies | `src/jobs/model.rs:10-12`, `src/handlers/jobs.rs:13`, `src/jobs/compress.rs:147` |
| C6 | WebSocket on :8081 spawns unbounded ffmpeg, no auth/origin/limit | `src/ws.rs:13-30` |
| C7 | `/export` returns `{"ok":true,"status":"exported"}` without uploading | `src/handlers/export.rs:29-48` |
| C8 | Range header integer underflow → `u64::MAX` allocation | `src/handlers/jobs.rs:39,45,48` |

Add `H15: ui/app/download/[id]/route.ts reads any file under /tmp/ via job.output_path`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/
git commit -m "docs: record security and design audit findings as spec"
```

---

### Task 0.2: Add a library target so integration tests can exist

**Files:**
- Create: `src/lib.rs`, `tests/smoke.rs`
- Modify: `src/main.rs:1-11`, `Cargo.toml`
- Move: `src/tests_lifecycle.rs` → `tests/lifecycle.rs`

**Interfaces:**
- Produces: `theflate::{auth, db, handlers, jobs, media, state, webhook}` importable from `tests/`. Every later `tests/*.rs` depends on this.

**Why this exists:** `Cargo.toml` declares no `[lib]`. A binary-only crate exports nothing, so `tests/` cannot import anything — which is why the crate's entire test suite is seven `content_type_for` assertions. This unblocks all integration testing.

- [ ] **Step 1: Write the failing test**

Create `tests/smoke.rs`:

```rust
use theflate::auth::rate_limit_for;

#[test]
fn library_target_is_importable() {
    assert_eq!(rate_limit_for(Some("free")), 60);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cargo test --test smoke
```
Expected: `error[E0432]: unresolved import theflate` — no library target.

- [ ] **Step 3: Create the library root**

Create `src/lib.rs` with exactly the module tree `main.rs` currently declares:

```rust
//! Library surface for the theflate service.
//!
//! `main.rs` is a thin binary that calls into this crate. The split exists so
//! `tests/` can import real types instead of re-implementing them — a
//! binary-only crate exports nothing to integration tests.

pub mod auth;
pub mod db;
pub mod handlers;
// pub mod ingest_store;   // uncomment in Task 1.2, which creates this file
pub mod jobs;
pub mod media;
pub mod state;
pub mod webhook;
pub mod ws;
```

- [ ] **Step 4: Reduce `main.rs` to a binary shim**

Delete lines 1–11 of `src/main.rs` (the eight `mod` declarations and the `#[cfg(test)] mod tests_lifecycle;` line). Replace with:

```rust
use theflate::{db, jobs, state, ws};
use theflate::state::{AppState, cors_origin, db_path, detect_hw};
```

Keep `fn main()` byte-identical. Then:

```bash
git mv src/tests_lifecycle.rs tests/lifecycle.rs
```

In `tests/lifecycle.rs`, replace every `use crate::` with `use theflate::` and delete the `#![cfg(test)]` line at the top (files in `tests/` are already test-only).

- [ ] **Step 5: Add the targets to Cargo.toml**

After `edition = "2021"`:

```toml
[lib]
name = "theflate"
path = "src/lib.rs"

[[bin]]
name = "theflate"
path = "src/main.rs"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 6: Verify green**

```bash
cargo test
```
Expected: PASS. `tests/smoke.rs` and the migrated `tests/lifecycle.rs` both run.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml src/lib.rs src/main.rs tests/
git commit -m "refactor: add library target so integration tests can import the crate"
```

---

### Task 1.1: Fix the ingest directory mismatch that would reject every upload

**Files:**
- Modify: `src/handlers/ingest.rs:19`
- Create: `tests/path_guard.rs`

**Interfaces:**
- Consumes: `media::path_guard::{resolve_input, ingest_dir}` (already landed).
- Produces: the guarantee that `ingest_dir()` is where `/ingest` actually writes. Task 1.2 depends on this.

**Why this exists:** `path_guard::ingest_dir()` defaults to `storage_dir()` (`/tmp/theflate_output`), but `handlers/ingest.rs:19` hardcodes `format!("/tmp/theflate_{}.{}", ...)` — a *different* directory. Wiring the guard in as-is would reject **every legitimate upload**. This is a self-inflicted outage if shipped alone. Closes **H6**.

- [ ] **Step 1: Write the failing test**

Create `tests/path_guard.rs`:

```rust
use std::fs;
use theflate::media::path_guard::{ingest_dir, resolve_input};

#[test]
fn a_file_written_where_ingest_writes_is_accepted() {
    let dir = ingest_dir();
    fs::create_dir_all(&dir).expect("create ingest dir");
    let p = format!("{dir}/theflate_test_fixture.mp4");
    fs::write(&p, b"not really an mp4").expect("write fixture");

    let resolved = resolve_input(&p);
    fs::remove_file(&p).ok();

    assert!(resolved.is_ok(), "ingest_dir() must be an accepted root, got {resolved:?}");
}
```

- [ ] **Step 2: Run it and prove the real bug**

```bash
cargo test --test path_guard
THEFLATE_STORAGE=/tmp/theflate_alt_root cargo test --test path_guard
```
Expected: the first passes by accident (both default to `/tmp`-ish paths); the **second FAILS**, because `/ingest` still writes to hardcoded `/tmp` which is not a configured root.

- [ ] **Step 3: Make ingest use the configured directory**

In `src/handlers/ingest.rs`, add `use crate::media::path_guard::ingest_dir;` and replace line 19:

```rust
let dir = ingest_dir();
if let Err(e) = tokio::fs::create_dir_all(&dir).await {
    tracing::error!("cannot create ingest dir {dir}: {e}");
    return Response { status: 500, body: r#"{"error":"storage unavailable"}"#.into(), ..Default::default() };
}
let path = format!("{dir}/theflate_{}.{}", Uuid::new_v4(), ext);
```

- [ ] **Step 4: Verify green under both configurations**

```bash
cargo test --test path_guard
THEFLATE_STORAGE=/tmp/theflate_alt_root cargo test --test path_guard
```
Expected: PASS in both.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/ingest.rs tests/path_guard.rs
git commit -m "fix: ingest writes to THEFLATE_STORAGE instead of hardcoded /tmp (H6)"
```

---

### Task 1.2: Replace client-supplied paths with opaque ingest ids

**Files:**
- Create: `src/ingest_store.rs`, `tests/ingest_contract.rs`
- Modify: `src/db.rs` (schema), `src/lib.rs` (uncomment module), `src/handlers/{ingest,analyze,upload,transcribe}.rs`

**Interfaces:**
- Consumes: `media::path_guard::resolve_output_ext`, `state::Db`, `auth::auth_and_rate`.
- Produces:
  - `ingest_store::record(db: &Db, id: &str, path: &str, owner: Option<&str>) -> rusqlite::Result<()>`
  - `ingest_store::resolve(db: &Db, id: &str, caller: Option<&str>) -> Option<String>`
  - `ingest_store::purge_expired(db: &Db) -> usize`
  - `handlers::analyze::json_err(status: u16, msg: &str) -> Response`

**Why this exists:** closes **C3** and **C4** at the root by removing the client's ability to name a server path at all. `resolve_input` remains as defence in depth for paths the server itself produces.

**Use case of each function:**
- `record` — called by `/ingest` immediately after bytes hit disk, so the id becomes redeemable.
- `resolve` — called by `/analyze` and `/upload` to turn a client's id into a path the server trusts, enforcing ownership in the same step. Returns `None` for unknown, expired, or wrongly-owned ids — indistinguishable to the caller, so it is not an existence oracle.
- `purge_expired` — called hourly by `cleanup.sh` so abandoned uploads stop being redeemable and stop consuming disk.
- `json_err` — builds a correctly-escaped JSON error body. Replaces the `format!(r#"{{"error":"{e}"}}"#)` pattern, which emits **invalid JSON** when the error text contains a quote (ffprobe messages routinely do), causing the frontend's `r.json()` to throw an opaque `SyntaxError`. Closes **M1**.

- [ ] **Step 1: Write the failing tests**

Create `tests/ingest_contract.rs`:

```rust
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use theflate::{db::init_db, ingest_store, state::Db};

fn mem_db() -> Db {
    let c = Connection::open_in_memory().unwrap();
    init_db(&c);
    Arc::new(Mutex::new(c))
}

#[test]
fn an_id_resolves_only_for_its_owner() {
    let db = mem_db();
    ingest_store::record(&db, "ing-1", "/srv/in/a.mp4", Some("vp_OWNER")).unwrap();

    assert_eq!(ingest_store::resolve(&db, "ing-1", Some("vp_OWNER")).as_deref(), Some("/srv/in/a.mp4"));
    assert_eq!(ingest_store::resolve(&db, "ing-1", Some("vp_OTHER")), None, "cross-tenant read");
    assert_eq!(ingest_store::resolve(&db, "ing-1", None), None, "anonymous read of owned ingest");
}

#[test]
fn anonymous_ingests_are_readable_anonymously_but_not_by_keys() {
    let db = mem_db();
    ingest_store::record(&db, "ing-2", "/srv/in/b.mp4", None).unwrap();
    assert_eq!(ingest_store::resolve(&db, "ing-2", None).as_deref(), Some("/srv/in/b.mp4"));
    assert_eq!(ingest_store::resolve(&db, "ing-2", Some("vp_X")), None);
}

#[test]
fn unknown_ids_never_resolve() {
    let db = mem_db();
    assert_eq!(ingest_store::resolve(&db, "../../etc/passwd", None), None);
    assert_eq!(ingest_store::resolve(&db, "", None), None);
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cargo test --test ingest_contract
```
Expected: FAIL — `unresolved import theflate::ingest_store`.

- [ ] **Step 3: Add the schema**

In `src/db.rs`, append to the first `execute_batch` inside `init_db`:

```sql
CREATE TABLE IF NOT EXISTS ingests (
    id         TEXT PRIMARY KEY,
    path       TEXT NOT NULL,
    owner_key  TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ingests_created ON ingests(created_at);
```

- [ ] **Step 4: Implement the store**

Create `src/ingest_store.rs`:

```rust
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
```

Uncomment `pub mod ingest_store;` in `src/lib.rs`.

- [ ] **Step 5: Verify the store tests pass**

```bash
cargo test --test ingest_contract
```
Expected: PASS (3 tests).

- [ ] **Step 6: Switch `/ingest` to return an id**

In `src/handlers/ingest.rs`, capture the caller and record the ingest. Replace the response construction:

```rust
let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };
// ...after the file is written and remuxed...
let final_path = remux_to_mp4_if_needed(&path).await;
let ingest_id = Uuid::new_v4().to_string();
if let Err(e) = crate::ingest_store::record(
    &state.db, &ingest_id, &final_path, caller.as_ref().map(|k| k.key.as_str())
) {
    tracing::error!("ingest record failed: {e}");
    return Response { status: 500, body: r#"{"error":"storage unavailable"}"#.into(), ..Default::default() };
}
Response {
    status: 200,
    body: serde_json::json!({ "ingest_id": ingest_id }).to_string().into(),
    ..Default::default()
}
```

- [ ] **Step 7: Switch `/analyze` to redeem ids**

Replace the body of `src/handlers/analyze.rs`, deleting `extract_path` entirely:

```rust
pub async fn analyze(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return json_err(400, "expected JSON body"),
    };
    let ingest_id = match body["ingest_id"].as_str() {
        Some(s) => s,
        None => return json_err(400, "missing ingest_id"),
    };
    let path = match crate::ingest_store::resolve(
        &state.db, ingest_id, caller.as_ref().map(|k| k.key.as_str())
    ) {
        Some(p) => p,
        None => return json_err(404, "unknown or expired ingest_id"),
    };

    match detect(&path).await {
        Ok(p)  => Response { status: 200, body: serde_json::to_string(&p).unwrap().into(), ..Default::default() },
        Err(_) => json_err(415, "unsupported media type"),
    }
}

/// Build a correctly-escaped JSON error. Never interpolate an error string
/// into a format! literal — ffprobe messages contain quotes and produce
/// invalid JSON that the frontend's r.json() throws on. (M1)
pub fn json_err(status: u16, msg: &str) -> Response {
    Response { status, body: serde_json::json!({ "error": msg }).to_string().into(), ..Default::default() }
}
```

- [ ] **Step 8: Switch `/upload` to redeem ids and guard `output_format`**

In `src/handlers/upload.rs`, apply the identical `ingest_id` → `resolve` substitution for lines 21-24, and replace lines 35-38:

```rust
if let Some(fmt) = output_format.as_deref() {
    // Unvalidated, this was interpolated straight into the output filename at
    // line 43, so `mp4/../../../etc/cron.d/x` made ffmpeg write anywhere. (C4)
    let ext = match crate::media::path_guard::resolve_output_ext(fmt) {
        Ok(e) => e,
        Err(_) => return json_err(400, "unsupported output format"),
    };
    profile.ffmpeg_args = format_ffmpeg_args(&profile.kind, &ext, &state.hw);
    profile.output_ext = ext;
}
```

Replace the `format!(r#"{{"error":"{e}"}}"#)` at line 33 with `json_err(415, "unsupported media type")`.

- [ ] **Step 9: Delete the `path` branch from `/transcribe`**

In `src/handlers/transcribe.rs`, delete lines 27-31 (the `else if let Some(p) = body["path"]` arm). `job_id` becomes the only accepted input; the `else` returns `json_err(400, "missing job_id")`.

- [ ] **Step 10: Verify green**

```bash
cargo test
```

- [ ] **Step 11: Commit**

```bash
git add src/ingest_store.rs src/lib.rs src/db.rs src/handlers/ tests/ingest_contract.rs
git commit -m "feat!: opaque ingest ids replace client-supplied paths (C3, C4, M1)"
```

---

### Task 1.3: Delete the unauthenticated screen-capture endpoints

**Files:**
- Delete: `src/handlers/capture.rs`, `src/jobs/capture.rs`
- Modify: `src/handlers/mod.rs:9`, `src/jobs/mod.rs:4`, `src/state.rs:5,22`, `src/main.rs:39`
- Modify: `ui/components/ScreenRecorder.tsx`
- Create: `tests/removed_routes.rs`

**Why this exists:** closes **C2**. `jobs/capture.rs:34-37` runs `ffmpeg -f x11grab -i <display>` where `display` comes from an unauthenticated request body defaulting to `:0.0`. This records the **server's** X display, not the user's screen — so it cannot be what `ScreenRecorder.tsx` wants, and there is no hosted use case. The browser-side recorder should use `navigator.mediaDevices.getDisplayMedia()` and stream to the existing WebSocket endpoint.

- [ ] **Step 1: Write the failing test**

Create `tests/removed_routes.rs`:

```rust
/// C2: /capture/start ran ffmpeg -f x11grab against the server's own display,
/// unauthenticated. These routes must not exist in the binary.
#[test]
fn capture_routes_are_not_registered() {
    let registered: Vec<&str> = glideapi::ROUTES.iter().map(|r| r.path).collect();
    assert!(!registered.iter().any(|p| p.starts_with("/capture")),
        "capture routes still registered: {registered:?}");
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cargo test --test removed_routes
```
Expected: FAIL — `/capture/start` and `/capture/stop` are present.

- [ ] **Step 3: Remove the modules**

```bash
git rm src/handlers/capture.rs src/jobs/capture.rs
```
Remove `pub mod capture;` from `src/handlers/mod.rs:9` and `src/jobs/mod.rs:4`. Remove the `captures` field from `AppState` (`src/state.rs:22`), the `CaptureStore` import (`src/state.rs:5`), and `captures: jobs::capture::new_store(),` from `src/main.rs:39`.

- [ ] **Step 4: Verify green**

```bash
cargo test && cargo build
```

- [ ] **Step 5: Point ScreenRecorder at the browser API**

In `ui/components/ScreenRecorder.tsx`, replace any `fetch` to `/capture/start` or `/capture/stop` with `getDisplayMedia` + `MediaRecorder`, sending chunks over the WebSocket at `ws://<host>:8081`. `LiveStream.tsx` already does exactly this — copy its connection logic rather than inventing a second one.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix!: remove unauthenticated server-side x11 screen capture (C2)"
```

---

### Task 1.4: Bound the download and preview endpoints

**Files:**
- Modify: `src/handlers/jobs.rs:35-60`, `src/handlers/preview.rs:23`
- Create: `tests/download_range.rs`

**Interfaces:**
- Produces: `handlers::jobs::parse_range(header: &str, total: u64) -> Option<(u64, u64)>`

**Why this exists:** closes **C8** (integer underflow → attempted `u64::MAX` allocation), **H11** (private media marked publicly cacheable behind a CDN) and **H5** (blocking `std::fs::read` of a whole file inside an async handler).

**Use case:** `parse_range` is a free function specifically so it can be tested without constructing a `Request` — the current inline closure cannot be.

- [ ] **Step 1: Write the failing test**

Create `tests/download_range.rs`:

```rust
use theflate::handlers::jobs::parse_range;

#[test]
fn rejects_ranges_that_would_underflow() {
    // start beyond EOF: `end - start + 1` underflows to ~u64::MAX
    assert_eq!(parse_range("bytes=99999999999-", 1000), None);
    assert_eq!(parse_range("bytes=900-100", 1000), None);   // inverted
    assert_eq!(parse_range("bytes=0-", 0), None);           // `total - 1` underflows
}

#[test]
fn accepts_well_formed_ranges() {
    assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
    assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
    assert_eq!(parse_range("bytes=0-99999", 1000), Some((0, 999)), "clamps to EOF");
}

#[test]
fn rejects_malformed_headers() {
    for h in ["", "bytes=", "items=0-10", "bytes=abc-def", "bytes=-100"] {
        assert_eq!(parse_range(h, 1000), None, "should reject {h:?}");
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cargo test --test download_range
```
Expected: FAIL — `parse_range` does not exist.

- [ ] **Step 3: Implement the parser**

In `src/handlers/jobs.rs`, above `download`:

```rust
/// Parse an RFC 7233 single byte-range against a known total size.
///
/// Returns `None` for anything malformed, inverted, or past EOF. The previous
/// inline version computed `end - start + 1` on unvalidated input, so
/// `Range: bytes=99999999999-` underflowed to roughly u64::MAX and became a
/// `vec![0u8; that]` allocation — a one-request remote DoS. (C8)
pub fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 { return None; }
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') { return None; }        // multi-range unsupported
    let (s, e) = spec.split_once('-')?;

    let start: u64 = s.trim().parse().ok()?;      // suffix ranges ("-100") rejected
    let end: u64 = match e.trim() {
        "" => total - 1,
        v  => v.parse().ok()?,
    };

    let end = end.min(total - 1);
    if start > end { return None; }
    Some((start, end))
}
```

- [ ] **Step 4: Use it, cap the chunk, and reject bad ranges**

Replace lines 35-46 of `download`:

```rust
/// Never materialise more than this per request. A 2 GB output served without
/// a Range header used to become a 2 GB allocation.
const MAX_CHUNK: u64 = 8 * 1024 * 1024;

let raw_range = req.headers.get("range");
let range = raw_range.and_then(|h| parse_range(h, total));
if raw_range.is_some() && range.is_none() {
    return Response { status: 416, body: r#"{"error":"invalid range"}"#.into(), ..Default::default() };
}
let (start, mut end, status) = match range {
    Some((s, e)) => (s, e, 206u16),
    None         => (0, total - 1, 200u16),
};
end = end.min(start + MAX_CHUNK - 1);
let len = end - start + 1;
```

- [ ] **Step 5: Fix the cache header**

Replace line 60's `cache-control` value with `private, no-store`. The current `public, max-age=86400, immutable` invites the Cloudflare layer described in the README's deploy notes to cache and potentially serve other people's media. Closes **H11**.

- [ ] **Step 6: Stop blocking the runtime in `/preview`**

`preview.rs:23` calls `std::fs::read` — synchronous I/O of an entire file inside an `async fn`, which stalls a tokio worker thread, and the UI polls this endpoint during encoding. Replace with a bounded async read:

```rust
// Read at most the first MAX_PREVIEW bytes, asynchronously. The doc comment
// above claims range-style chunked delivery; it did a full blocking read. (H5)
const MAX_PREVIEW: usize = 4 * 1024 * 1024;

use tokio::io::AsyncReadExt;
let mut f = match tokio::fs::File::open(&job.output_path).await {
    Ok(f) => f,
    Err(_) => return Response { status: 204, ..Default::default() },
};
let mut bytes = Vec::new();
if f.take(MAX_PREVIEW as u64).read_to_end(&mut bytes).await.is_err() || bytes.is_empty() {
    return Response { status: 204, ..Default::default() };
}
```

- [ ] **Step 7: Verify green**

```bash
cargo test
```

- [ ] **Step 8: Commit**

```bash
git add src/handlers/jobs.rs src/handlers/preview.rs tests/download_range.rs
git commit -m "fix: bound download ranges, async preview, stop caching private media (C8, H11, H5)"
```

---

### Task 1.5: Stop the WebSocket from being an unbounded process spawner

**Files:**
- Modify: `src/ws.rs:13-30`, `src/jobs/stream.rs:62`

**Why this exists:** closes **C6** and **M9**. `ws.rs:13-30` spawns one ffmpeg per accepted connection with no auth, no `Origin` check, no rate limit, and — critically — **without acquiring `job_sem`**, the semaphore that bounds ffmpeg concurrency everywhere else. WebSockets are not subject to CORS, so any page can open this socket from a victim's browser. Also fixes the `while let Ok(...)` accept loop, which terminates permanently on a single transient error such as `EMFILE`.

- [ ] **Step 1: Bound and survive**

Replace the accept loop in `src/ws.rs`:

```rust
loop {
    let (tcp, peer) = match listener.accept().await {
        Ok(pair) => pair,
        Err(e) => {
            // A transient EMFILE must not kill live-streaming until restart.
            // The previous `while let Ok(..)` exited the loop permanently.
            tracing::warn!("ws accept error: {e}");
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        }
    };

    // Bound concurrent ffmpeg processes with the same semaphore /upload uses.
    // Without this, N connections spawn N ffmpeg processes. (C6)
    let permit = match state.job_sem.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => { tracing::warn!("ws capacity reached, rejecting {peer}"); continue; }
    };

    let state = state.clone();
    tokio::spawn(async move {
        let _permit = permit;   // held for the session's lifetime
        // ... existing session body unchanged ...
    });
}
```

- [ ] **Step 2: Validate the Origin header**

Replace `accept_async(tcp)` with `tokio_tungstenite::accept_hdr_async(tcp, callback)` where the callback rejects any request whose `Origin` header does not equal `state::cors_origin()`.

- [ ] **Step 3: Stop reporting failed encodes as successful**

`src/jobs/stream.rs:62` does `let _ = session.child.wait().await;`, discarding the exit status — so a failed ffmpeg still yields a `Done` job pointing at a zero-byte file, and `/download/:id` then 404s. Replace:

```rust
let status = session.child.wait().await;
let size = std::fs::metadata(&session.output).map(|m| m.len()).unwrap_or(0);
let ok = matches!(status, Ok(s) if s.success()) && size > 0;
let job_status = if ok { JobStatus::Done } else { JobStatus::Failed };
```
and use `job_status` in the `Job` construction. Closes **M9**.

- [ ] **Step 4: Verify and commit**

```bash
cargo build && cargo test
git add src/ws.rs src/jobs/stream.rs
git commit -m "fix: bound websocket ffmpeg spawns, validate origin, survive accept errors (C6, M9)"
```

---

### Task 1.6: Repair the migration chain and stop resetting created_at

**Files:**
- Modify: `src/db.rs:52-58`, `src/db.rs:65-85`, `src/db.rs:129-165`
- Create: `tests/migrations.rs`
- Modify: `tests/lifecycle.rs` (remove `#[ignore]`)

**Why this exists:** closes **H12**, **H8**, **M4**.
- `execute_batch` stops at the first failing statement and `.ok()` swallows it. On any existing database the first `ALTER` fails ("duplicate column") and **every subsequent migration silently never runs.** Add a sixth migration today and it will never apply in production.
- `upsert_job` omits `created_at` from its column list, so `INSERT OR REPLACE` deletes and re-inserts with `DEFAULT (unixepoch())`. Progress ticks fire every 500ms (`compress.rs:112`), so `created_at` is permanently "now" — and `cleanup.sh`'s `created_at < now-7200` stale sweep can never fire for a job whose progress task is still running. A hung ffmpeg is immortal.
- `load_all_jobs` omits `destination_json` and `remote_url`, silently dropping them on restart, and calls `.unwrap()` twice — a malformed row panics the process at boot.

- [ ] **Step 1: Write the failing tests**

Create `tests/migrations.rs`:

```rust
use rusqlite::Connection;
use theflate::db::init_db;

#[test]
fn every_migration_applies_on_a_second_boot() {
    let c = Connection::open_in_memory().unwrap();
    init_db(&c);
    init_db(&c);   // simulate a restart against an existing database

    for col in ["white_label_domain", "white_label_brand", "default_destination"] {
        let n: i64 = c.query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('api_keys') WHERE name='{col}'"),
            [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "api_keys.{col} missing after second init");
    }
    for col in ["destination_json", "remote_url"] {
        let n: i64 = c.query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('jobs') WHERE name='{col}'"),
            [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "jobs.{col} missing after second init");
    }
}
```

Then delete the `#[ignore = "known defect: upsert_job resets created_at on every update"]` attribute from `created_at_survives_progress_updates` in `tests/lifecycle.rs`.

- [ ] **Step 2: Run and watch it fail**

```bash
cargo test --test migrations --test lifecycle
```
Expected: `created_at_survives_progress_updates` FAILS.

- [ ] **Step 3: Run migrations individually**

Replace `src/db.rs:52-58`:

```rust
// Each ALTER runs on its own. execute_batch() aborts the whole batch at the
// first error, and on any existing database the first ALTER always fails
// ("duplicate column"), which silently skipped every later migration. (H12)
const MIGRATIONS: &[&str] = &[
    "ALTER TABLE api_keys ADD COLUMN white_label_domain TEXT",
    "ALTER TABLE api_keys ADD COLUMN white_label_brand TEXT",
    "ALTER TABLE api_keys ADD COLUMN default_destination TEXT",
    "ALTER TABLE jobs ADD COLUMN destination_json TEXT",
    "ALTER TABLE jobs ADD COLUMN remote_url TEXT",
    "ALTER TABLE jobs ADD COLUMN owner_key TEXT",          // used by Task 2.4
];
for stmt in MIGRATIONS {
    match conn.execute(stmt, []) {
        Ok(_) => tracing::info!("migration applied: {stmt}"),
        Err(e) if e.to_string().contains("duplicate column") => {}   // already applied
        Err(e) => tracing::error!("migration failed: {stmt}: {e}"),
    }
}
```

- [ ] **Step 4: Preserve `created_at`**

Replace the SQL in `upsert_job` — `ON CONFLICT DO UPDATE` never touches columns it does not name, unlike `INSERT OR REPLACE` which deletes the row first:

```sql
INSERT INTO jobs
  (id,status,media_kind,input_path,output_path,original_bytes,compressed_bytes,
   duration_secs,progress,eta_secs,webhook_url,preset,destination_json,remote_url)
VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
ON CONFLICT(id) DO UPDATE SET
  status=excluded.status, progress=excluded.progress, eta_secs=excluded.eta_secs,
  compressed_bytes=excluded.compressed_bytes, output_path=excluded.output_path,
  destination_json=excluded.destination_json, remote_url=excluded.remote_url
```

- [ ] **Step 5: Load every column on restart**

Add `destination_json` and `remote_url` to the `SELECT` in `load_all_jobs` and populate the fields instead of hardcoding `None`. Replace both `.unwrap()` calls with `.map(...).unwrap_or_default()` so a malformed row cannot panic the process at startup.

- [ ] **Step 6: Verify green**

```bash
cargo test
```
Expected: PASS, including the newly un-ignored `created_at_survives_progress_updates`.

- [ ] **Step 7: Commit**

```bash
git add src/db.rs tests/migrations.rs tests/lifecycle.rs
git commit -m "fix: migrations apply individually, created_at survives updates (H12, H8, M4)"
```

---

### Task 1.7: Clean up /tmp leakage and cap unbounded work

**Files:**
- Modify: `src/jobs/compress.rs:40,44`, `src/jobs/yt_dlp.rs:17`, `cleanup.sh`

**Why this exists:** closes **H7**, **M10**, **M11**. Every job writes `/tmp/{uuid}_progress`, which `cleanup.sh:27` never matches (it globs only `theflate_*`), so these accumulate forever. `target_mb` is uncapped and yt-dlp has no size limit. Together these are why the dev machine hit `ENOSPC` mid-audit.

- [ ] **Step 1: Move progress files into storage**

`src/jobs/compress.rs:40`:
```rust
let progress_file = format!("{}/{id}_progress", crate::state::storage_dir());
```

- [ ] **Step 2: Cap target_mb**

At `src/jobs/compress.rs:44`, before computing the bitrate:
```rust
// A 1e12 target produces an absurd bitrate and fills the disk. (M11)
const MAX_TARGET_MB: f64 = 10_240.0;
let mb = mb.clamp(0.1, MAX_TARGET_MB);
```

- [ ] **Step 3: Cap yt-dlp downloads**

`src/jobs/yt_dlp.rs:17` — add to the args vector:
```rust
"--max-filesize".to_string(), "4G".to_string(),
```

- [ ] **Step 4: Fix the cleanup script**

Replace the two `find` lines in `cleanup.sh`:

```bash
# Outputs and progress files both live under $STORAGE now.
find "$STORAGE" -type f -mmin +1440 -delete
find "$STORAGE" -name '*_progress' -type f -mmin +120 -delete
# Legacy: files the old build wrote directly into /tmp. -maxdepth 1 stops this
# from walking the entire filesystem tree under /tmp.
find /tmp -maxdepth 1 -name 'theflate_*' -type f -mmin +120 -delete
```

Add an ingest purge mirroring `ingest_store::purge_expired`:

```bash
python3 -c "
import sqlite3, time, sys
conn = sqlite3.connect(sys.argv[1])
cur = conn.execute('DELETE FROM ingests WHERE created_at < ?', (int(time.time()) - 7200,))
conn.commit(); print(f'Purged {cur.rowcount} expired ingests'); conn.close()
" "\$DB"
```

- [ ] **Step 5: Verify and commit**

```bash
cargo test && bash -n cleanup.sh
git add src/jobs/ cleanup.sh
git commit -m "fix: contain temp files and cap unbounded work (H7, M10, M11)"
```

---

### Task 1.8: Wire the auth gate safely

**Files:**
- Modify: `src/auth.rs`, `src/handlers/keys.rs`
- Create: `.env.example`, `tests/auth_gate.rs`

**Why this exists:** `auth_and_rate` was implemented in a prior session but **turning it on is itself an outage risk**. With `THEFLATE_TRUST_PROXY` unset, `extract_ip` returns `"unknown"` for everyone, so the 10 req/min anonymous limit becomes 10 req/min *globally* — and since the frontend sends no API key, every real user is anonymous. This task makes activation safe. Also closes **H9** (plaintext key storage) and **H10** (unauthenticated key minting → permanent white-label domain squatting via the UNIQUE index at `db.rs:60`).

- [ ] **Step 1: Write the failing test**

Create `tests/auth_gate.rs`:

```rust
use theflate::auth::{generate_api_key, hash_key};

#[test]
fn stored_keys_are_hashed_not_plaintext() {
    let k = generate_api_key();
    let h = hash_key(&k);
    assert_ne!(h, k, "key stored verbatim");
    assert_eq!(h.len(), 64, "expected hex sha256");
    assert_eq!(hash_key(&k), h, "hash must be deterministic");
}
```

- [ ] **Step 2: Add hashing**

In `src/auth.rs`:

```rust
/// API keys are stored as SHA-256 hex, never verbatim. A database dump must
/// not hand over live credentials. (H9)
///
/// Unsalted SHA-256 is correct here and is NOT a password-hashing mistake:
/// these are 128-bit random tokens, not user-chosen secrets, so there is no
/// dictionary to attack, and lookup must remain a single indexed query.
pub fn hash_key(raw: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(raw.as_bytes()))
}
```

Change `lookup_api_key` to pass `hash_key(key)` as the query parameter. Change `create_key` to store `hash_key(&key)` while returning the plaintext `key` to the caller exactly once — it is unrecoverable afterwards.

- [ ] **Step 3: Require an admin token to mint keys**

In `src/handlers/keys.rs`, before the insert:

```rust
// Unauthenticated key minting let anyone permanently squat a white-label
// domain via the UNIQUE index on api_keys.white_label_domain. (H10)
let expected = std::env::var("THEFLATE_ADMIN_TOKEN").ok();
match (expected.as_deref(), req.headers.get("x-admin-token").map(|s| s.as_str())) {
    (Some(want), Some(got)) if !want.is_empty() && got == want => {}
    _ => return json_err(403, "forbidden"),
}
```

- [ ] **Step 4: Document the required environment**

Create `.env.example`:

```bash
# REQUIRED in production. Without TRUST_PROXY=1 every anonymous caller shares
# one 10 req/min bucket, because extract_ip cannot see the peer address.
THEFLATE_TRUST_PROXY=1
THEFLATE_PROXY_HOPS=1          # reverse proxies in front of this process
THEFLATE_ADMIN_TOKEN=          # required to mint API keys via POST /keys
THEFLATE_STORAGE=/var/lib/theflate/output
THEFLATE_DB=/var/lib/theflate/theflate.db
THEFLATE_CORS_ORIGIN=https://yourdomain.com
THEFLATE_WEBHOOK_SECRET=       # HMAC signing key for webhooks (Task 2.2)
THEFLATE_MAX_JOBS=             # concurrent ffmpeg limit; defaults to CPU count
```

- [ ] **Step 5: Verify and commit**

```bash
cargo test
git add src/auth.rs src/handlers/keys.rs .env.example tests/auth_gate.rs
git commit -m "feat: hash api keys, gate key minting, document required env (H9, H10)"
```

---

# PHASE B — Make the endpoints real

**Aim:** every endpoint either does what it advertises or returns an honest error. No endpoint returns success for work it did not perform.

---

### Task 2.1: Ship the PublicJob contract across both codebases

**Files:**
- Modify: `src/handlers/jobs.rs:13`, `src/jobs/compress.rs:147`, `src/jobs/yt_dlp.rs:49`
- Modify: `ui/lib/store.ts:5-16`
- Delete: `ui/app/download/[id]/route.ts`

**Interfaces:**
- Consumes: `jobs::model::Job::public() -> PublicJob<'_>` (already landed, currently **called by nothing**).
- Produces: the `/jobs/:id` response shape `{ id, status, media_kind, original_bytes, compressed_bytes, duration_secs, progress, eta_secs, preset, remote_url, has_destination }`.

**Why this exists:** closes **C5** and **H15**. `Job::public()` was written but never wired, so the credential leak is still fully open. This is deliberately one task spanning both codebases because shipping either half alone breaks the app.

- [ ] **Step 1: Use PublicJob on the wire**

- `src/handlers/jobs.rs:13` → `serde_json::to_string(&j.public())`
- `src/jobs/compress.rs:147` → `serde_json::to_string(&job_clone.public())`
- `src/jobs/yt_dlp.rs:49` → `serde_json::to_string(&job_clone.public())`

- [ ] **Step 2: Update the frontend type**

In `ui/lib/store.ts`, delete `input_path` and `output_path` from the `Job` interface (lines 9-10) and add:

```ts
remote_url?: string;
has_destination?: boolean;
```

TypeScript now flags every consumer that read a path.

- [ ] **Step 3: Delete the duplicate download route**

```bash
git rm "ui/app/download/[id]/route.ts"
```

It reads `job.output_path` (now gone), `readFile`s anything under `/tmp/` (**H15** — a second arbitrary-file-read), buffers whole files into memory, and duplicates `GET /download/:id` on the Rust side. `ui/lib/api.ts:44` already points at the Rust endpoint, so nothing references it.

- [ ] **Step 4: Verify both build**

```bash
cargo test
cd ui && bunx tsc --noEmit && bun run build
```
Expected: every remaining `output_path` reader is now a compile error. Fix each by using the job id.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix!: /jobs/:id returns PublicJob; delete duplicate download route (C5, H15)"
```

---

### Task 2.2: Sign webhooks and stop them being an SSRF vector

**Files:**
- Create: `src/webhook/sign.rs`, `tests/webhook_sign.rs`
- Modify: `src/webhook.rs` → `src/webhook/mod.rs`; `src/handlers/upload.rs:25`, `src/handlers/download_url.rs:12-27,47`

**Interfaces:**
- Produces:
  - `webhook::sign::signature(secret: &str, body: &str, ts: i64) -> String` → `"t=<ts>,v1=<hex>"`
  - `webhook::is_public_url(url: &str) -> bool` — shared SSRF guard, replacing the bypassable `is_safe_url`.

**Why this exists:** closes **H2** (HMAC advertised at README:118 and sold as a premium feature, entirely absent from `webhook.rs:9-13`), **H3** (`webhook_url` has no SSRF guard at all, and reqwest follows redirects by default), and **H4** (`is_safe_url` prefix-matches on text and is defeated by `http://evil.com@127.0.0.1/`, `http://2130706433/`, and `http://[::ffff:a9fe:a9fe]/`).

**Use case of each function:**
- `signature` — called once per delivery attempt; the receiver recomputes it to prove the payload came from theflate and was not replayed. The timestamp is inside the signed material, so an old body cannot be resent.
- `is_public_url` — called at *request admission time* for both `url` and `webhook_url`, so a bad URL is rejected with a 400 the caller can see, rather than swallowed inside a background task.

- [ ] **Step 1: Write the failing tests**

Create `tests/webhook_sign.rs`:

```rust
use theflate::webhook::{is_public_url, sign::signature};

#[test]
fn signature_is_stable_and_timestamped() {
    let s = signature("secret", r#"{"id":"j1"}"#, 1_757_404_860);
    assert!(s.starts_with("t=1757404860,v1="));
    assert_eq!(s, signature("secret", r#"{"id":"j1"}"#, 1_757_404_860));
    assert_ne!(s, signature("other", r#"{"id":"j1"}"#, 1_757_404_860));
}

#[test]
fn ssrf_guard_blocks_known_bypasses() {
    for bad in [
        "http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/",
        "http://evil.com@127.0.0.1/",     // userinfo confusion
        "http://2130706433/",             // decimal-encoded 127.0.0.1
        "http://0177.0.0.1/",             // octal
        "http://[::ffff:a9fe:a9fe]/",     // IPv6-mapped cloud metadata
        "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/",
        "file:///etc/passwd", "gopher://x/",
    ] {
        assert!(!is_public_url(bad), "should block {bad}");
    }
    assert!(is_public_url("https://hooks.example.com/theflate"));
}
```

- [ ] **Step 2: Implement by resolving DNS, not string-matching**

Create `src/webhook/sign.rs` using `hmac` + `sha2`. In `src/webhook/mod.rs`, implement `is_public_url` by parsing the URL, extracting the host, and **resolving it via `std::net::ToSocketAddrs`**, then rejecting if any resolved address satisfies `ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified()`. Reject any scheme other than `http`/`https` up front.

String prefix matching cannot be made correct — every bypass in the test list defeats it. Resolution defeats all of them at once.

- [ ] **Step 3: Send the signature**

In `deliver`, add `.header("x-theflate-signature", signature(&secret, payload, ts))`. Read the secret from `THEFLATE_WEBHOOK_SECRET`; if unset, log a warning once and deliver unsigned rather than failing the job.

- [ ] **Step 4: Stop retrying client errors**

`webhook.rs:15-22` retries any non-2xx three times. A 400/404/410 will never succeed. Retry only on 5xx, 429, and transport errors.

- [ ] **Step 5: Validate at admission**

In `handlers/upload.rs` and `handlers/download_url.rs`, return `400` if `webhook_url` is present and `!is_public_url(url)`. Replace `download_url.rs`'s local `is_safe_url` (lines 12-27) with `webhook::is_public_url` and delete the old function.

- [ ] **Step 6: Verify and commit**

```bash
cargo test
git add src/webhook/ src/handlers/ tests/webhook_sign.rs
git commit -m "feat: HMAC-sign webhooks and block SSRF at admission (H2, H3, H4)"
```

---

### Task 2.3: Make /export actually upload, or fail honestly

**Files:**
- Create: `src/export/s3.rs`, `src/export/mod.rs`
- Modify: `src/handlers/export.rs:29-48`, `src/jobs/compress.rs:132-142`, `src/jobs/yt_dlp.rs:34-44`

**Interfaces:**
- Produces: `export::s3::upload(cfg: &DestinationConfig, local_path: &str) -> Result<String, String>` — returns the real object URL or an error.

**Why this exists:** closes **C7**, the most serious product defect in the repo. `export.rs:29-48` string-builds a plausible S3 URL, reads the **local** file's size, and returns `{"ok":true,"status":"exported"}`. Nothing is uploaded. The same fabrication appears at `compress.rs:136` and `yt_dlp.rs:38`, complete with pre-rename `vpx-media-bucket` / `vpxengine.com` defaults. A missing endpoint fails loudly; this one lies and bills for it.

**Use case:** `upload` is called after a job reaches `Done`, only when `job.destination` is present. It streams the file to an S3-compatible endpoint — S3, R2, B2 and Supabase Storage all speak this protocol — and returns the canonical URL.

- [ ] **Step 1: Implement real upload**

Create `src/export/s3.rs` using `aws-sdk-s3` with a custom endpoint so R2/B2/Supabase work. Credentials come from `DestinationConfig.access_key` / `secret_key`. Stream via `ByteStream::from_path` — do **not** read the file into memory.

- [ ] **Step 2: Return 501 for unimplemented providers**

Replace the fabricated `match` in `handlers/export.rs`:

```rust
let remote_url = match provider {
    "s3" | "r2" | "b2" | "supabase" => match crate::export::s3::upload(&cfg, &file_path).await {
        Ok(url) => url,
        Err(e) => { tracing::error!("export failed: {e}"); return json_err(502, "export failed"); }
    },
    // Fabricating a plausible URL for a provider we do not support is worse
    // than saying no — the customer discovers it when the file isn't there. (C7)
    "gdrive" | "dropbox" => return json_err(501, "provider not yet supported"),
    _ => return json_err(400, "unknown provider"),
};
```

- [ ] **Step 3: Remove the fabrication from the job paths**

Delete the `remote_url = Some(match dest.provider ...)` blocks from `compress.rs:136-141` and `yt_dlp.rs:38-43`. Replace with a call to `export::s3::upload`, setting `remote_url` only on success and logging on failure.

- [ ] **Step 4: Verify and commit**

```bash
cargo test && cargo build
git add src/export/ src/handlers/export.rs src/jobs/
git commit -m "fix!: /export uploads for real or returns 501 (C7)"
```

---

### Task 2.4: Add resource ownership

**Files:**
- Modify: `src/db.rs` (add `get_job_for`), `src/handlers/{jobs,preview,export,transcribe}.rs`
- Create: `tests/ownership.rs`

**Interfaces:**
- Consumes: the `jobs.owner_key` column added by the `MIGRATIONS` array in Task 1.6.
- Produces: `db::get_job_for(db: &Db, id: &str, caller: Option<&str>) -> Option<Job>`

**Why this exists:** closes **H1**. No endpoint checks who owns a job — `handlers/jobs.rs:10-11` looks up by ID alone. Job IDs travel through QR-code share links (README:13), so they leak by design. Anyone holding one can read, download, preview, transcribe and export someone else's media.

**Use case:** `get_job_for` is the *only* job accessor handlers may call. It returns `None` — not an error — when the caller does not own the row, so a `404` is indistinguishable from "does not exist". Returning `403` would confirm the job exists.

- [ ] **Step 1: Write the failing test**

Create `tests/ownership.rs`:

```rust
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use theflate::{db::{init_db, get_job_for, upsert_job}, state::Db};

fn mem_db() -> Db {
    let c = Connection::open_in_memory().unwrap();
    init_db(&c);
    Arc::new(Mutex::new(c))
}

#[test]
fn a_job_is_invisible_to_other_keys() {
    let db = mem_db();
    // insert a job owned by alice (helper writes owner_key directly)
    db.lock().unwrap().execute(
        "INSERT INTO jobs(id,status,media_kind,input_path,output_path,owner_key)
         VALUES('job-x','done','video','/in/a.mp4','/out/a.mp4','vp_ALICE')", []).unwrap();

    assert!(get_job_for(&db, "job-x", Some("vp_ALICE")).is_some());
    assert!(get_job_for(&db, "job-x", Some("vp_BOB")).is_none(), "cross-tenant read");
    assert!(get_job_for(&db, "job-x", None).is_none(), "anonymous read of owned job");
}
```

- [ ] **Step 2: Add the scoped accessor**

In `src/db.rs`, add `get_job_for` alongside `get_job`, with `WHERE id = ?1 AND owner_key IS ?2`. SQLite's `IS` compares NULLs correctly, so an anonymous job (`owner_key NULL`) matches `caller = None` and nothing else.

- [ ] **Step 3: Set the owner at creation**

In `handlers/upload.rs` and `handlers/download_url.rs`, persist `caller.as_ref().map(|k| k.key.as_str())` into `owner_key` when the job row is first written.

- [ ] **Step 4: Replace every unscoped lookup**

In `handlers/{jobs,preview,export,transcribe}.rs`, replace `get_job(&state.db, &id)` with `get_job_for(&state.db, &id, caller)`. Also replace the in-memory `state.jobs.lock()...get(&id)` fast path, which bypasses the check entirely.

- [ ] **Step 5: Verify and commit**

```bash
cargo test
git add src/db.rs src/handlers/ tests/ownership.rs
git commit -m "feat: scope job access to the owning key (H1)"
```

---

### Task 2.5: Move transcription off the request path

**Files:**
- Modify: `src/handlers/transcribe.rs:37-71`

**Why this exists:** closes **M7** and **M8**. `transcribe.rs:37-39` runs Whisper synchronously inside the HTTP handler, bypassing `job_sem` entirely and holding the request for minutes. The 600s `request_timeout` drops the connection but the process keeps running (tokio's `Command` does not `kill_on_drop` by default), so orphaned Whisper processes accumulate. And `transcribe.rs:65` returns raw Whisper stderr — Python tracebacks containing server paths — straight to the client.

- [ ] **Step 1: Return 202 and spawn**

Mirror the `/upload` pattern: insert a `transcriptions` row with `status='queued'`, `tokio::spawn` the work while holding a `job_sem` permit, and return `202 {"transcription_id": "..."}` immediately. `GET /transcriptions/:id` already exists for polling. Add a `status` column to `transcriptions` via the `MIGRATIONS` array.

- [ ] **Step 2: Stop leaking stderr**

Replace the `"detail": stderr.trim()` field at line 65 with a `tracing::error!` call. The response body becomes `{"error":"transcription failed"}`.

- [ ] **Step 3: Verify and commit**

```bash
cargo test
git add src/handlers/transcribe.rs src/db.rs
git commit -m "fix: transcription runs async under the job semaphore (M7, M8)"
```

---

# PHASE C — Interface

**Aim:** an interface that reads as designed, on a token system that makes inconsistency impossible, with motion that encodes what the product does.

**Design direction** *(already landed in `ui/app/globals.css` in a prior session)*: **precision instrument**. Near-black ground `#0C0C0E` — not `#000`, which is the default nobody chose and smears on OLED during scroll. One signal colour, acid lime `#C9F24E`, used **only** where a number or state changes. Archivo for text, JetBrains Mono for every numeral with `tabular-nums`.

**Motion budget — the rule that keeps it simple:**

> At most two things move at once. Nothing exceeds 560ms. Nothing loops unless work is actually happening.

**Flow cycle for this phase:** `bun run build && bunx tsc --noEmit` after every task, plus a visual check at 375 / 768 / 1024 / 1440.

---

### Task 3.1: Delete the fabricated hero animation

**Files:**
- Delete: `ui/components/DeflationPipelineAnimation.tsx`
- Modify: `ui/app/page.tsx:11,36`

**Why this exists:** it hardcodes `1.24 GB → 142 MB (-88%)` — a specific compression claim rendered as static decoration, which the operating doc's §10 forbids outright. Its `viewBox="0 0 2320 280"` is an 8.3:1 aspect ratio: at 375px wide it is 45px tall containing 36px and 22px text. And its two SMIL `<animate>` loops (lines 83, 108, 118) run forever regardless of state and are **immune to the `prefers-reduced-motion` block**, because CSS cannot stop SMIL.

- [ ] **Step 1: Remove it**

```bash
git rm ui/components/DeflationPipelineAnimation.tsx
```
Delete the import at `ui/app/page.tsx:11` and the usage at line 36.

- [ ] **Step 2: Verify and commit**

```bash
cd ui && bun run build
git add -A && git commit -m "refactor: remove fabricated hero animation (mock data, a11y, mobile)"
```

---

### Task 3.2: Build the primitives and delete the competing systems

**Files:**
- Create: `ui/lib/format.ts`, `ui/lib/format.test.ts`, `ui/components/primitives/Button.tsx`
- Modify: all 12 `.vpx-button-*` call sites
- Modify: `ui/app/globals.css` (remove aliases at the end)

**Interfaces:**
- Produces:
  - `format.bytes(n: number): string` → `"1.24 GB"`
  - `format.duration(secs: number): string` → `"2:18"`
  - `format.ratio(before: number, after: number): string` → `"−88%"`
  - `<Button variant="primary"|"secondary"|"ghost" size="sm"|"md" loading?: boolean>`

**Why this exists:** there are three competing styling systems — **345 inline `style={{}}` objects** (70 in FileCard alone), 12 `.vpx-*` class uses, and ~30 Tailwind/shadcn uses. None won. Inline styles cannot express `@media`, `:hover`, `:focus-visible` or `prefers-reduced-motion`, which is why the app has **no responsive design and no focus styles anywhere**. That absence of system *is* the generated look — it is an architecture problem, not a taste problem.

**Use case of each function:**
- `format.bytes` — every size display. Each call site currently formats inline and they disagree with each other.
- `format.ratio` — the headline number. Returns a true minus sign `−` (U+2212), not a hyphen, because at display sizes a hyphen reads as a dash.
- `format.duration` — ETAs and media length.
- `Button` — the single interactive control, replacing both parallel systems.

- [ ] **Step 1: Write the failing test**

Create `ui/lib/format.test.ts`:

```ts
import { bytes, duration, ratio } from "./format";

test("bytes uses binary units with two decimals", () => {
  expect(bytes(0)).toBe("0 B");
  expect(bytes(1024)).toBe("1.00 KB");
  expect(bytes(1_331_691_945)).toBe("1.24 GB");
});

test("ratio returns a true minus sign and handles zero", () => {
  expect(ratio(1000, 120)).toBe("−88%");
  expect(ratio(0, 0)).toBe("—");     // no division by zero
});

test("duration formats as m:ss", () => {
  expect(duration(138)).toBe("2:18");
  expect(duration(0)).toBe("0:00");
});
```

- [ ] **Step 2: Implement `format.ts`, then `Button.tsx`**

`Button` uses `className` with tokens from `globals.css` — **never inline styles**. It must render a real `<button>`, forward `ref`, support `disabled`, and render the `.track` bar when `loading`.

- [ ] **Step 3: Replace all 12 call sites**

`.vpx-button-primary` → `<Button variant="primary">` at `FileCard.tsx:344,449,470`, `UrlDownloader.tsx:65,100`, `LiveStream.tsx:99,110`, `ScreenRecorder.tsx:112`, `app/poem/page.tsx:30`.
`.vpx-button-secondary` → `<Button variant="secondary">` at `FileCard.tsx:401,420,464`, `app/poem/page.tsx:33`.

- [ ] **Step 4: Remove the aliases and dead primitives**

Once no call site references them, delete the `.vpx-button-primary` / `.vpx-button-secondary` selectors from `globals.css`, keeping `.btn`. Then delete `ui/components/ui/{button,badge,card,separator}.tsx` if `grep -r` shows no importers.

- [ ] **Step 5: Verify and commit**

```bash
cd ui && bunx tsc --noEmit && bun run build
git add -A && git commit -m "refactor(ui): single Button primitive and shared formatters"
```

---

### Task 3.3: Make the dropzone keyboard-accessible

**Files:**
- Modify: `ui/components/DropZone.tsx`

**Why this exists:** **the highest-priority accessibility fix in the app.** `DropZone.tsx:35-36` is a `<div>` with `onClick`, no `role`, no `tabIndex`, no `onKeyDown`, and the file input is `display: none` (line 107), which removes it from the accessibility tree entirely. **The primary action of the entire product cannot be reached by keyboard.** WCAG 2.1.1, Level A.

- [ ] **Step 1: Make the input the control**

Keep a real `<input type="file">` visually hidden but focusable — `position:absolute; width:1px; height:1px; opacity:0` — **never `display:none`**. Wrap it in a `<label>` so clicking anywhere activates it and screen readers announce it. Add `aria-describedby` pointing at the accepted-formats list.

- [ ] **Step 2: Stop the layout shift**

Replace `padding: dragging ? "52px 24px" : "44px 24px"` (line 43) with constant padding. Signal drag state with `border-color` and `background` only. Animating padding under `transition: all` (line 51) triggers reflow every frame and shifts the entire page below by 16px on drag-over — a layout-shift-on-hover, forbidden by §10.

- [ ] **Step 3: Fix the drag-leave flicker**

`onDragLeave` fires when the pointer crosses onto a child element. Track a depth counter: increment on `dragenter`, decrement on `dragleave`, clear `dragging` only at zero.

- [ ] **Step 4: Remove the third-party ping**

Delete the `useEffect` at lines 17-32. It fetches `https://www.google.com/favicon.ico` on every mount — leaking your users' visits to Google — and the math is wrong regardless: `mode:"no-cors"` returns an opaque response so the timing is unreliable, and `(1/1024/(ms/1000))*8` assumes a 1KB payload that is actually ~5KB and usually cached. Use `navigator.connection.downlink` where available and a static default otherwise.

- [ ] **Step 5: Fix the false state message**

Line 79 reads `"Processing..."` while merely dragging. Nothing is processing. Use `"Release to upload"`.

- [ ] **Step 6: Verify with a keyboard**

```bash
cd ui && bun dev
```
Tab to the dropzone. Confirm a visible lime focus ring (from `:focus-visible` in `globals.css`), and that both Enter and Space open the file picker.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "fix(a11y): dropzone is keyboard-operable; remove layout shift and third-party ping"
```

---

### Task 3.4: Build the signature motion moment

**Files:**
- Create: `ui/components/CountUp.tsx`, `ui/components/JobProgress.tsx`
- Modify: `ui/components/FileCard.tsx`

**Interfaces:**
- Consumes: `format.bytes`, `format.ratio`; the `.contract` / `.track` / `.tabular` classes from `globals.css`.
- Produces: `<CountUp from={number} to={number} format={(n: number) => string} durationMs={number} />`

**Why this exists:** this is the highest-leverage motion work in the app and it **currently does not exist** — when a job completes, the size simply appears. The product's entire value is a number getting smaller; that deserves the one gesture worth remembering.

**Motion spec — the "contract" gesture:** on completion, the output size animates from the original value down to the compressed value over `--dur-4` (560ms) on `--ease-snap`, while the `.contract` keyframe scales from 1.06 → 1 and tightens letter-spacing from `0.04em` → `-0.01em`. It reads as the file physically compacting. `tabular-nums` from `.tabular` stops the digits jittering as they count.

**Use case:** `CountUp` animates any numeric transition via `requestAnimationFrame`. It must read `window.matchMedia("(prefers-reduced-motion: reduce)")` and, when set, render the final value on the first frame.

- [ ] **Step 1: Write the failing test**

```ts
test("CountUp respects reduced motion", () => {
  mockMatchMedia({ "(prefers-reduced-motion: reduce)": true });
  render(<CountUp from={1000} to={120} format={String} durationMs={560} />);
  expect(screen.getByText("120")).toBeInTheDocument();   // final value immediately
});
```

- [ ] **Step 2: Implement `CountUp`**

Use `requestAnimationFrame` with the same expo curve as `--ease-out`: `1 - Math.pow(1 - t, 3)`. Cancel the frame on unmount. **Never use `setInterval`** — it drifts and does not pause with the tab.

- [ ] **Step 3: Extract `JobProgress`**

Pull progress rendering out of `FileCard`. Determinate: a filled bar whose width is `job.progress`, transitioning over `--dur-2`. Indeterminate (`queued`): the `.track` class, which sweeps a lit sliver and **stops when work stops**.

- [ ] **Step 4: Wire the reveal on completion**

When `job.status` flips to `done`, render the result row with `className="contract tabular"` and `<CountUp from={original_bytes} to={compressed_bytes} format={bytes} />`, plus the ratio in `--color-signal`. This is the **only** place in the app that uses `.contract` — spending it once is what makes it land.

- [ ] **Step 5: Verify and commit**

```bash
cd ui && bunx tsc --noEmit && bun run build
git add -A && git commit -m "feat(motion): contract gesture on job completion"
```

---

### Task 3.5: Migrate FileCard and page.tsx off inline styles

**Files:**
- Modify: `ui/components/FileCard.tsx` (70 inline styles), `ui/app/page.tsx` (9), `ui/components/Navbar.tsx:29`

**Why this exists:** FileCard is the largest file and where responsive design actually pays. Until it uses classes, it cannot have breakpoints, hover states, or focus styles.

- [ ] **Step 1: Replace the hero**

`page.tsx:26` `fontSize: 46` → `className="display"`. `page.tsx:30` → `className="lede"`. The `.display` clamp handles 375→1440 with no breakpoints, fixing the fixed-46px overflow at 375px.

- [ ] **Step 2: Unify the measure**

`Navbar.tsx:29` uses `maxWidth: 1100`; `page.tsx:22` uses `900`. The logo does not line up with the hero beneath it. Replace both with `className="measure"`.

- [ ] **Step 3: Make the tab bar real tabs**

`page.tsx:39-66` has `border:"none"` (no focus ring), no `role="tablist"`, no `aria-selected`, no arrow-key navigation, and with `whiteSpace:"nowrap"` + `flex:1` on four labels including "Upload & Theflate" it **overflows horizontally at 375px**. Add `role="tablist"` / `role="tab"` / `aria-selected`, arrow-key handling, and let labels shorten below 480px.

- [ ] **Step 4: Convert FileCard**

Work top to bottom. Every size → a `--text-*` token; every colour → a `--color-*` token; every gap → a `--spacing-*` token. Every numeric display gets `className="tabular"`. Every micro-label gets `className="label"`.

- [ ] **Step 5: Add the load stagger**

Wrap queue items with `className="reveal"` and `style={{ "--i": index } as React.CSSProperties}`. One orchestrated entrance at 60ms intervals, then the page is still.

- [ ] **Step 6: Verify at every breakpoint**

```bash
cd ui && bun dev
```
Check 375 / 768 / 1024 / 1440. Confirm no horizontal body scroll at 375.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(ui): migrate FileCard and page to the token system"
```

---

### Task 3.6: Fix the API client for the new contract

**Files:**
- Modify: `ui/lib/api.ts`, `README.md`

**Why this exists:** closes **H13** (the frontend never sends `x-api-key` in any of its seven functions, so no paid tier can be exercised from the product's own UI), **M12** (`downloadFile` buffers whole files via `r.blob()` at line 46 and revokes the object URL synchronously after `.click()` at line 51 — a known cancellation race), and **M14** (env var name mismatch).

- [ ] **Step 1: Send the key**

Add a shared `headers()` helper that includes `x-api-key` when one is stored, and use it in every function.

- [ ] **Step 2: Adopt the ingest contract**

`ingestFile` resolves `ingest_id`, not `path` (line 13). `uploadFile(ingestId, ...)` sends `{ ingest_id }` (line 37).

- [ ] **Step 3: Stop buffering downloads**

Replace the `r.blob()` + `createObjectURL` + immediate-revoke dance with a direct navigation to the download URL. The server already sets `content-disposition: attachment`, so the browser streams it — no 2GB buffer in a mobile tab, no revoke race.

- [ ] **Step 4: Fix the env var name**

`api.ts:1` reads `NEXT_PUBLIC_API_URL`; README:44 documents `NEXT_PUBLIC_BASE_URL`. Keep `NEXT_PUBLIC_API_URL` and correct the README.

- [ ] **Step 5: Verify and commit**

```bash
cd ui && bunx tsc --noEmit && bun run build
git add -A && git commit -m "fix(api): auth header, ingest ids, streamed downloads (H13, M12, M14)"
```

---

# PHASE D — Prove it end-to-end

**Aim:** a single command that starts the stack, drives every advertised endpoint, and fails loudly if any of them lie.

**Flow cycle:** `cargo test --test e2e_lifecycle` boots the real binary against a temp DB and temp storage. `bun run e2e` drives the real browser against it.

---

### Task 4.1: Rust integration tests against a live server

**Files:**
- Create: `tests/e2e_lifecycle.rs`

**Interfaces:**
- Consumes: everything from Phases A and B.

**Why this exists:** unit tests prove functions; only this proves the wiring. It is also the regression net for the contract change in Task 2.1.

**Use case:** `TestServer` spawns the compiled binary with `THEFLATE_DB` and `THEFLATE_STORAGE` pointed at a `tempfile::TempDir`, polls `GET /health` until it returns 200, and kills the child on `Drop` so a failing test never leaks a process.

- [ ] **Step 1: Write the harness and the assertions**

Generate a tiny valid MP4 with `ffmpeg -f lavfi -i testsrc=d=1:s=64x64 -y <tmp>/fixture.mp4`, then assert in order:

1. `POST /ingest` → 200; body has `ingest_id`; body has **no** `path` key.
2. `POST /analyze {ingest_id}` → 200 with `kind: "video"`.
3. `POST /analyze {"ingest_id":"nonexistent"}` → **404**.
4. `POST /upload {ingest_id}` → 202 with `job_id`.
5. Poll `GET /jobs/:id` until `status == "done"` (30s timeout).
6. That response contains **no** `output_path`, **no** `input_path`, **no** `secret_key`.
7. `GET /download/:id` → 200; `content-length` matches; `cache-control` is `private, no-store`.
8. `GET /download/:id` with `Range: bytes=99999999999-` → **416**, and the server is still alive afterwards.
9. `POST /export {"provider":"gdrive"}` → **501**, never `{"ok":true}`.
10. `POST /capture/start` → **404** (route deleted in Task 1.3).
11. `POST /upload` with `output_format: "mp4/../../../tmp/pwn"` → **400**.

- [ ] **Step 2: Run and commit**

```bash
cargo test --test e2e_lifecycle -- --test-threads=1
git add tests/e2e_lifecycle.rs
git commit -m "test: end-to-end lifecycle against a live server"
```

---

### Task 4.2: Playwright browser tests

**Files:**
- Create: `ui/playwright.config.ts`, `ui/e2e/compress.spec.ts`, `ui/e2e/a11y.spec.ts`
- Modify: `ui/package.json`

- [ ] **Step 1: Install**

```bash
cd ui && bun add -d @playwright/test && bunx playwright install chromium
```

- [ ] **Step 2: Cover the happy path**

Upload a fixture via `setInputFiles`, wait for the result row, assert the compressed size is smaller than the original and that the ratio renders with a `−` prefix.

- [ ] **Step 3: Cover accessibility and responsive**

- Tab from page load; assert the dropzone receives a visible focus ring.
- Assert Enter on the focused dropzone opens the file chooser.
- At 375×667, assert `document.body.scrollWidth <= 375` (no horizontal scroll).
- With Playwright's `reducedMotion: "reduce"`, assert the result value is final immediately.

- [ ] **Step 4: Add the script**

In `ui/package.json`: `"e2e": "playwright test"`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: playwright coverage for compression, a11y and responsive"
```

---

### Task 4.3: Close the deployment gaps

**Files:**
- Modify: `nginx.conf`, `README.md`

- [ ] **Step 1: Proxy the WebSocket**

Port 8081 is absent from `nginx.conf` entirely, so live-streaming requires exposing it raw — bypassing TLS and every proxy control (**M13**). Add a `location /ws/` block with `Upgrade` / `Connection` headers proxying to `127.0.0.1:8081`.

- [ ] **Step 2: Add the missing routes**

The regex at `nginx.conf:40` omits `/export`, `/preview` and `/health`. Add them.

- [ ] **Step 3: Add security headers**

`Strict-Transport-Security`, and a `Content-Security-Policy` allowing only self plus the API origin.

- [ ] **Step 4: Correct the README**

Update the endpoint table for the `ingest_id` contract, remove `/capture/*`, correct `NEXT_PUBLIC_BASE_URL` → `NEXT_PUBLIC_API_URL`, and document `x-theflate-signature` with a verification snippet so integrators can actually use the HMAC that README:118 has been promising.

- [ ] **Step 5: Commit**

```bash
git add nginx.conf README.md
git commit -m "chore: proxy websocket, add security headers, correct docs (M13, M14)"
```

---

## Definition of Done

- [ ] `cargo test` green, including `tests/e2e_lifecycle.rs`
- [ ] `cd ui && bun run build && bunx tsc --noEmit && bun run e2e` green
- [ ] Every `C*` and `H*` finding in the spec marked `CLOSED` with a commit sha
- [ ] No endpoint returns `{"ok": true}` for work it did not perform
- [ ] `grep -ri "vpx" src/ ui/ --include=*.rs --include=*.tsx --include=*.css` returns nothing
- [ ] No horizontal scroll at 375px on any route
- [ ] Every interactive element reachable by keyboard with a visible focus ring
- [ ] `prefers-reduced-motion: reduce` stops every animation in the app

---

## Self-Review

**Spec coverage.** All 8 Criticals assigned: C1→1.8, C2→1.3, C3/C4→1.2, C5→2.1, C6→1.5, C7→2.3, C8→1.4. All 15 Highs: H1→2.4, H2/H3/H4→2.2, H5→1.4, H6→1.1, H7→1.7, H8→1.6, H9/H10→1.8, H11→1.4, H12→1.6, H13→3.6, H14→1.2, H15→2.1. Mediums are folded into the task whose file they touch: M1→1.2, M4→1.6, M7/M8→2.5, M9→1.5, M10/M11→1.7, M12/M14→3.6, M13→4.3.

**Known gaps, stated rather than hidden:**
- **M2** (`state.streams` has a writer at `ws.rs:30` and no reader, so live-stream preview 404s by construction) and **M3** (the `webhook_deliveries` table is declared at `db.rs:23` and never written) are **not assigned to any task**. Both are dead wiring rather than defects with a victim. Add them to Task 1.5 and Task 2.2 respectively if you want them closed in this pass.
- **M5** (`.unwrap()` on every mutex — one panic poisons the lock and kills the service) is addressed only for *new* code via the Global Constraints. A sweep of the ~20 existing call sites is deliberately out of scope; it would touch every file and make every diff in this plan unreviewable.
- **M6** (the in-memory `jobs` HashMap is never evicted) is unassigned. It is a slow leak, not a breach.
- **M15** (VP9/WebM ETA is off by 10-50× because `detect.rs:102` uses `duration × 0.8` for an encoder far slower than realtime) is unassigned.

**Type consistency verified:** `resolve_input` / `resolve_output_ext` (Task 1.2) match the signatures already landed in `src/media/path_guard.rs`. `Job::public()` (Task 2.1) matches the landed `PublicJob<'a>`. `rate_limit_for` and `generate_api_key` (Tasks 0.2, 1.8) match the landed `src/auth.rs`. `ingest_store::{record, resolve, purge_expired}` are defined in Task 1.2 Step 4 before first use in Step 6. `json_err` is defined in Task 1.2 Step 7 and used from Tasks 1.8, 2.3 and 2.4. `db::get_job_for` is defined in Task 2.4 Step 2 before use in Step 4. The `jobs.owner_key` column that Task 2.4 depends on is added by the `MIGRATIONS` array in Task 1.6 Step 3.
