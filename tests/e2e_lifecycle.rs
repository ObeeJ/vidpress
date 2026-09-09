/// End-to-end lifecycle tests against a real spawned server.
///
/// Requires: ffmpeg on PATH (to generate the fixture) and the compiled binary.
/// Run with: cargo test --test e2e_lifecycle -- --test-threads=1
///
/// Each test boots the binary against a temp DB and temp storage, polls
/// GET /health until ready, then drives the full advertised contract.

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tempfile::TempDir;

struct TestServer {
    child: Child,
    port: u16,
    _tmp: TempDir,
}

impl TestServer {
    fn start() -> Self {
        let tmp = TempDir::new().expect("tempdir");
        let db   = tmp.path().join("test.db");
        let stor = tmp.path().join("storage");
        std::fs::create_dir_all(&stor).ok();
        let port = 18080u16;

        let child = Command::new(env!("CARGO_BIN_EXE_theflate"))
            .env("THEFLATE_DB",      db.to_str().unwrap())
            .env("THEFLATE_STORAGE", stor.to_str().unwrap())
            .env("THEFLATE_CORS_ORIGIN", "http://localhost:3000")
            .env("THEFLATE_ADMIN_TOKEN", "test-admin-token")
            .env("PORT", port.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn theflate binary");

        // Poll /health until ready (up to 10s)
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if Instant::now() > deadline { panic!("server did not start in time"); }
            if let Ok(r) = ureq::get(&format!("http://127.0.0.1:{port}/health")).call() {
                if r.status() == 200 { break; }
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        TestServer { child, port, _tmp: tmp }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) { let _ = self.child.kill(); }
}

fn make_fixture() -> tempfile::NamedTempFile {
    let f = tempfile::Builder::new().suffix(".mp4").tempfile().expect("tempfile");
    let status = Command::new("ffmpeg")
        .args(["-y", "-f", "lavfi", "-i", "testsrc=d=1:s=64x64",
               "-c:v", "libx264", "-t", "1", f.path().to_str().unwrap()])
        .stdout(Stdio::null()).stderr(Stdio::null())
        .status().expect("ffmpeg");
    assert!(status.success(), "ffmpeg fixture generation failed");
    f
}

#[test]
#[ignore = "requires compiled binary and ffmpeg; run with --test-threads=1"]
fn full_lifecycle_and_negative_cases() {
    let srv = TestServer::start();
    let fixture = make_fixture();

    // 1. POST /ingest -> 200; body has ingest_id; body has NO path key
    let body = std::fs::read(fixture.path()).unwrap();
    let resp = ureq::post(&srv.url("/ingest"))
        .set("x-file-name", "test.mp4")
        .send_bytes(&body)
        .expect("ingest");
    assert_eq!(resp.status(), 200);
    let json: serde_json::Value = resp.into_json().unwrap();
    assert!(json["ingest_id"].is_string(), "missing ingest_id");
    assert!(json["path"].is_null() || !json.as_object().unwrap().contains_key("path"),
        "path must not be in response");
    let ingest_id = json["ingest_id"].as_str().unwrap().to_string();

    // 2. POST /analyze {ingest_id} -> 200 with kind: "video"
    let resp = ureq::post(&srv.url("/analyze"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({ "ingest_id": ingest_id }))
        .expect("analyze");
    assert_eq!(resp.status(), 200);
    let json: serde_json::Value = resp.into_json().unwrap();
    assert_eq!(json["kind"].as_str().unwrap_or(""), "video");

    // 3. POST /analyze with nonexistent ingest_id -> 404
    let resp = ureq::post(&srv.url("/analyze"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({ "ingest_id": "nonexistent-id" }));
    assert_eq!(resp.unwrap_err().into_response().unwrap().status(), 404);

    // 4. POST /upload {ingest_id} -> 202 with job_id
    let resp = ureq::post(&srv.url("/upload"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({ "ingest_id": ingest_id, "preset": "web" }))
        .expect("upload");
    assert_eq!(resp.status(), 202);
    let json: serde_json::Value = resp.into_json().unwrap();
    let job_id = json["job_id"].as_str().expect("job_id").to_string();

    // 5. Poll GET /jobs/:id until done (30s timeout)
    let deadline = Instant::now() + Duration::from_secs(30);
    let job = loop {
        if Instant::now() > deadline { panic!("job did not complete in time"); }
        let resp = ureq::get(&srv.url(&format!("/jobs/{job_id}")))
            .call().expect("poll");
        let j: serde_json::Value = resp.into_json().unwrap();
        match j["status"].as_str() {
            Some("done") => break j,
            Some("failed") => panic!("job failed"),
            _ => std::thread::sleep(Duration::from_millis(500)),
        }
    };

    // 6. Response contains NO output_path, NO input_path, NO secret_key
    let wire = job.to_string();
    assert!(!wire.contains("output_path"), "output_path leaked");
    assert!(!wire.contains("input_path"),  "input_path leaked");
    assert!(!wire.contains("secret_key"),  "secret_key leaked");

    // 7. GET /download/:id -> 200; cache-control is private, no-store
    let resp = ureq::get(&srv.url(&format!("/download/{job_id}")))
        .call().expect("download");
    assert_eq!(resp.status(), 200);
    let cc = resp.header("cache-control").unwrap_or("");
    assert!(cc.contains("private") && cc.contains("no-store"),
        "cache-control must be private, no-store; got: {cc}");

    // 8. GET /download/:id with hostile Range -> 416; server still alive
    let resp = ureq::get(&srv.url(&format!("/download/{job_id}")))
        .set("range", "bytes=99999999999-")
        .call();
    assert_eq!(resp.unwrap_err().into_response().unwrap().status(), 416);
    // Server still alive
    assert_eq!(ureq::get(&srv.url("/health")).call().unwrap().status(), 200);

    // 9. POST /export {provider: "gdrive"} -> 501, never {"ok":true}
    let resp = ureq::post(&srv.url("/export"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({ "job_id": job_id, "provider": "gdrive" }));
    assert_eq!(resp.unwrap_err().into_response().unwrap().status(), 501);

    // 10. POST /capture/start -> 404 (route deleted)
    let resp = ureq::post(&srv.url("/capture/start"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({}));
    assert_eq!(resp.unwrap_err().into_response().unwrap().status(), 404);

    // 11. POST /upload with path traversal in output_format -> 400
    let resp = ureq::post(&srv.url("/upload"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({
            "ingest_id": ingest_id,
            "output_format": "mp4/../../../tmp/pwn"
        }));
    assert_eq!(resp.unwrap_err().into_response().unwrap().status(), 400);
}
