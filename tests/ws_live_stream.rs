use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::{Message, client::IntoClientRequest}};

// Runs against a live `theflate` server already listening on :8081 (the
// process's own THEFLATE_CORS_ORIGIN decides the allowed Origin below) rather
// than spawning a second one, since ws.rs binds a fixed, non-configurable
// port and two listeners can't share it.
#[tokio::test]
async fn test_ws_live_stream_handshake_and_chunk_upload() {
    let mut req = "ws://127.0.0.1:8081".into_client_request().expect("build request");
    req.headers_mut().insert("origin", "http://localhost:3000".parse().unwrap());

    let (mut ws_stream, _resp) = connect_async(req)
        .await
        .expect("ws connect failed — is a theflate server running on :8081 with THEFLATE_CORS_ORIGIN=http://localhost:3000?");

    // 1. Handshake message must carry a job_id
    let job_id = match ws_stream.next().await {
        Some(Ok(Message::Text(txt))) => {
            let v: serde_json::Value = serde_json::from_str(&txt).expect("handshake not json");
            v["job_id"].as_str().expect("no job_id in handshake").to_string()
        }
        other => panic!("expected text handshake message, got {other:?}"),
    };
    assert!(!job_id.is_empty());

    // 2. Send a real chunk of raw bytes down the socket (ffmpeg won't produce
    //    valid output from garbage input, but this proves the binary-frame
    //    pipe from websocket -> ffmpeg stdin is actually wired up).
    ws_stream.send(Message::Binary(vec![0u8; 4096].into())).await.expect("send chunk failed");

    // 3. Close cleanly.
    ws_stream.send(Message::Close(None)).await.ok();
    drop(ws_stream);
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // 4. The job should now be visible through the main HTTP API (port 8080),
    //    proving finish_session actually persisted it — not just that the
    //    socket layer accepted bytes.
    let resp = reqwest::get(format!("http://127.0.0.1:8080/jobs/{job_id}"))
        .await
        .expect("GET /jobs/:id failed — is the HTTP server on :8080 also running?");
    assert_eq!(
        resp.status(),
        200,
        "expected the stream job to be recorded and visible via GET /jobs/:id"
    );
}
