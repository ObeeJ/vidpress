/// End-to-end lifecycle tests against a real spawned server.
///
/// Requires: ffmpeg on PATH (for fixture generation), the compiled binary.
/// Run with: cargo test --test e2e_lifecycle -- --test-threads=1
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tempfile::TempDir;

struct TestServer {
    child: Child,
    port: u16,
    _db_dir: TempDir,
    _storage_dir: TempDir,
}

impl TestServer {
    fn start() -> Self {
        let db_dir = TempDir::new().unwrap();
        let storage_dir = TempDir::new().unwrap();
        let port = 18080u16;

        let child = Command::new(env!("CARGO_BIN_EXE_theflate"))
            .env("THEFLATE_DB", db_dir.path().join("test.db"))
            .env("THEFLATE_STORAGE", storage_dir.path())
            .env("THEFLATE_TRUST_PROXY", "0")
            .env("THEFLATE_ADMIN_TOKEN", "test-admin-token")
            .env("PORT", port.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn theflate binary");

        // Poll /health until ready (max 10s)
        let client = reqwest::blocking::Client::new();
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(100));
            if client.get(format!("http://127.0.0.1:{port}/health")).send()
                .map(|r| r.status().is_success()).unwrap_or(false)
            {
                break;
            }
        }

        TestServer { child, port, _db_dir: db_dir, _storage_dir: storage_dir }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

fn make_fixture() -> tempfile::NamedTempFile {
    let f = tempfile::Builder::new().suffix(".mp4").tempfile().unwrap();
    Command::new("ffmpeg")
        .args(["-f", "lavfi", "-i", "testsrc=d=1:s=64x64", "-y", f.path().to_str().unwrap()])
        .stdout(Stdio::null()).stderr(Stdio::null())
        .status().expect("ffmpeg not found");
    f
}

#[test]
fn full_lifecycle() {
    let server = TestServer::start();
    let client = reqwest::blocking::Client::new();
    let fixture = make_fixture();

    // Mint an API key so we don't hit the anonymous 10 req/min limit.
    let r = client.post(server.url("/keys"))
        .header("x-admin-token", "test-admin-token")
        .json(&serde_json::json!({ "name": "e2e-test", "plan": "free" }))
        .send().unwrap();
    assert!(r.status().is_success(), "key creation failed: {}", r.status());
    let key_body: serde_json::Value = r.json().unwrap();
    let api_key = key_body["key"].as_str().unwrap().to_string();

    let authed = |method: reqwest::blocking::RequestBuilder| {
        method.header("x-api-key", &api_key)
    };

    // 1. POST /ingest → ingest_id, no path
    let bytes = std::fs::read(fixture.path()).unwrap();
    let r = authed(client.post(server.url("/ingest")))
        .header("x-file-name", "test.mp4")
        .body(bytes)
        .send().unwrap();
    assert_eq!(r.status(), 200, "ingest failed");
    let body: serde_json::Value = r.json().unwrap();
    assert!(body["ingest_id"].is_string(), "missing ingest_id");
    assert!(body["path"].is_null() || body.get("path").is_none(), "path leaked in ingest response");
    let ingest_id = body["ingest_id"].as_str().unwrap().to_string();

    // 2. POST /analyze {ingest_id} → kind: video
    let r = authed(client.post(server.url("/analyze")))
        .json(&serde_json::json!({ "ingest_id": ingest_id }))
        .send().unwrap();
    assert_eq!(r.status(), 200, "analyze failed");
    let body: serde_json::Value = r.json().unwrap();
    assert_eq!(body["kind"].as_str().unwrap_or(""), "video");

    // 3. POST /analyze with unknown id → 404
    let r = authed(client.post(server.url("/analyze")))
        .json(&serde_json::json!({ "ingest_id": "nonexistent-id" }))
        .send().unwrap();
    assert_eq!(r.status(), 404);

    // 4. POST /upload {ingest_id} → job_id
    let r = authed(client.post(server.url("/upload")))
        .json(&serde_json::json!({ "ingest_id": ingest_id, "preset": "web" }))
        .send().unwrap();
    assert_eq!(r.status(), 202, "upload failed");
    let body: serde_json::Value = r.json().unwrap();
    let job_id = body["job_id"].as_str().unwrap().to_string();

    // 5. Poll until done (30s timeout)
    let mut job_body = serde_json::Value::Null;
    for _ in 0..300 {
        std::thread::sleep(Duration::from_millis(100));
        let r = authed(client.get(server.url(&format!("/jobs/{job_id}")))).send().unwrap();
        let b: serde_json::Value = r.json().unwrap();
        if b["status"].as_str() == Some("done") || b["status"].as_str() == Some("failed") {
            job_body = b;
            break;
        }
    }
    assert_eq!(job_body["status"].as_str(), Some("done"), "job did not complete: {job_body}");

    // 6. PublicJob — no paths or credentials
    for leaked in ["output_path", "input_path", "secret_key", "access_key"] {
        assert!(job_body.get(leaked).is_none(), "PublicJob leaked field: {leaked}");
    }

    // 7. GET /download/:id → 200, private cache-control
    let r = authed(client.get(server.url(&format!("/download/{job_id}")))).send().unwrap();
    assert_eq!(r.status(), 200);
    let cc = r.headers().get("cache-control").and_then(|v| v.to_str().ok()).unwrap_or("");
    assert!(cc.contains("private") || cc.contains("no-store"), "bad cache-control: {cc}");

    // 8. Range underflow → 416, server still alive
    let r = authed(client.get(server.url(&format!("/download/{job_id}"))))
        .header("range", "bytes=99999999999-")
        .send().unwrap();
    assert_eq!(r.status(), 416);
    assert_eq!(client.get(server.url("/health")).send().unwrap().status(), 200, "server died after 416");

    // 9. POST /export with gdrive → 501
    let r = authed(client.post(server.url("/export")))
        .json(&serde_json::json!({ "job_id": job_id, "provider": "gdrive" }))
        .send().unwrap();
    assert_eq!(r.status(), 501);
    let body: serde_json::Value = r.json().unwrap();
    assert_ne!(body["ok"].as_bool(), Some(true), "/export returned ok:true for gdrive");

    // 10. POST /capture/start → 404 (route deleted)
    let r = client.post(server.url("/capture/start"))
        .json(&serde_json::json!({}))
        .send().unwrap();
    assert_eq!(r.status(), 404);

    // 11. Path traversal in output_format → 400
    let r = authed(client.post(server.url("/upload")))
        .json(&serde_json::json!({ "ingest_id": ingest_id, "output_format": "mp4/../../../tmp/pwn" }))
        .send().unwrap();
    assert_eq!(r.status(), 400);
}
