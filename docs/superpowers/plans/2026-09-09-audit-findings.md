# theflate — Security & Design Audit Findings

| ID | Severity | Title | Evidence (file:line) | Status |
|---|---|---|---|---|
| C1 | Critical | `auth_and_rate` was a stub returning `Ok(None)` — all rate limits and plan gates dead | `src/auth.rs:69-71` | OPEN |
| C2 | Critical | Unauthenticated x11grab capture of the server's display | `src/handlers/capture.rs:12`, `src/jobs/capture.rs:34-37` | OPEN |
| C3 | Critical | Client-supplied `path` → arbitrary file read + SSRF via ffmpeg protocols | `src/handlers/upload.rs:21`, `analyze.rs:19`, `transcribe.rs:27`, `src/media/detect.rs:37` | OPEN |
| C4 | Critical | `output_format` → arbitrary file write | `src/handlers/upload.rs:27,36,43`, `src/media/ffmpeg_args.rs:125` | OPEN |
| C5 | Critical | S3 credentials leak via `GET /jobs/:id` and webhook bodies | `src/jobs/model.rs:10-12`, `src/handlers/jobs.rs:13`, `src/jobs/compress.rs:147` | OPEN |
| C6 | Critical | WebSocket on :8081 spawns unbounded ffmpeg, no auth/origin/limit | `src/ws.rs:13-30` | OPEN |
| C7 | Critical | `/export` returns `{"ok":true,"status":"exported"}` without uploading | `src/handlers/export.rs:29-48` | OPEN |
| C8 | Critical | Range header integer underflow → `u64::MAX` allocation | `src/handlers/jobs.rs:39,45,48` | OPEN |
| H1 | High | No endpoint checks job ownership — any job id grants full access | `src/handlers/jobs.rs:10-11` | OPEN |
| H2 | High | Webhook HMAC advertised but entirely absent | `src/webhook.rs:9-13` | OPEN |
| H3 | High | `webhook_url` has no SSRF guard; reqwest follows redirects | `src/webhook.rs` | OPEN |
| H4 | High | `is_safe_url` prefix-matches text, defeated by userinfo/decimal/octal/IPv6-mapped bypasses | `src/handlers/download_url.rs:12-27` | OPEN |
| H5 | High | Blocking `std::fs::read` of whole file inside async handler | `src/handlers/preview.rs:23` | OPEN |
| H6 | High | `ingest.rs` writes to hardcoded `/tmp/theflate_*`, not `ingest_dir()` | `src/handlers/ingest.rs:19` | OPEN |
| H7 | High | Progress files written to `/tmp/{uuid}_progress`, never cleaned up | `src/jobs/compress.rs:40` | OPEN |
| H8 | High | `upsert_job` uses `INSERT OR REPLACE`, resetting `created_at` on every progress tick | `src/db.rs:65-85` | OPEN |
| H9 | High | API keys stored in plaintext in the database | `src/auth.rs`, `src/db.rs` | OPEN |
| H10 | High | Unauthenticated key minting → permanent white-label domain squatting | `src/handlers/keys.rs` | OPEN |
| H11 | High | Private media served with `public, max-age=86400, immutable` cache header | `src/handlers/jobs.rs:60` | OPEN |
| H12 | High | `execute_batch` aborts at first duplicate-column error; all subsequent migrations silently never run | `src/db.rs:52-58` | OPEN |
| H13 | High | Frontend never sends `x-api-key`; no paid tier exercisable from the UI | `ui/lib/api.ts` | OPEN |
| H14 | High | Client-supplied `path` accepted by `/analyze` and `/transcribe` without guard | `src/handlers/analyze.rs:19`, `src/handlers/transcribe.rs:27` | OPEN |
| H15 | High | `ui/app/download/[id]/route.ts` reads any file under `/tmp/` via `job.output_path` | `ui/app/download/[id]/route.ts:21` | OPEN |
| M1 | Medium | `format!(r#"{{\"error\":\"{e}\"}}"#)` emits invalid JSON when error text contains a quote | Multiple handlers | OPEN |
| M2 | Medium | `state.streams` written at `ws.rs:30`, never read — live-stream preview 404s by construction | `src/ws.rs:30`, `src/state.rs` | OPEN |
| M3 | Medium | `webhook_deliveries` table declared at `db.rs:23`, never written | `src/db.rs:23` | OPEN |
| M4 | Medium | `created_at` reset on every progress tick; stale-job cleanup can never fire for running jobs | `src/db.rs:65-85` | OPEN |
| M5 | Medium | ~20 `Mutex::unwrap()` calls — one panic poisons the lock and kills the service | Multiple files | OPEN |
| M6 | Medium | In-memory `jobs` HashMap is never evicted | `src/state.rs` | OPEN |
| M7 | Medium | Whisper runs synchronously inside the HTTP handler, bypassing `job_sem` | `src/handlers/transcribe.rs:37-39` | OPEN |
| M8 | Medium | Orphaned Whisper processes accumulate after 600s request timeout drops connection | `src/handlers/transcribe.rs` | OPEN |
| M9 | Medium | `stream.rs` discards ffmpeg exit status; failed encodes reported as `Done` | `src/jobs/stream.rs:62` | OPEN |
| M10 | Medium | `target_mb` is uncapped; a 1e12 value produces an absurd bitrate | `src/jobs/compress.rs:44` | OPEN |
| M11 | Medium | yt-dlp has no `--max-filesize` limit | `src/jobs/yt_dlp.rs:17` | OPEN |
| M12 | Medium | `downloadFile` buffers whole file via `r.blob()` then revokes URL synchronously — cancellation race | `ui/lib/api.ts:46,51` | OPEN |
| M13 | Medium | WebSocket port 8081 absent from nginx.conf — live-streaming bypasses TLS and proxy controls | `nginx.conf` | OPEN |
| M14 | Medium | `api.ts:1` reads `NEXT_PUBLIC_API_URL`; README documents `NEXT_PUBLIC_BASE_URL` | `ui/lib/api.ts:1`, `README.md:44` | OPEN |
| M15 | Medium | VP9/WebM ETA off by 10-50× — `detect.rs:102` uses `duration × 0.8` for a far-slower encoder | `src/media/detect.rs:102` | OPEN |
