use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_hdr_async, tungstenite::Message};
use tokio_tungstenite::tungstenite::handshake::server::{Request as WsRequest, Response as WsResponse};
use uuid::Uuid;
use crate::{jobs::stream as stream_job, state::{AppState, cors_origin}};

pub async fn listen(state: Arc<AppState>) {
    let addr = "0.0.0.0:8081";
    let listener = TcpListener::bind(addr).await.expect("ws bind failed");
    tracing::info!("WebSocket stream endpoint on ws://{addr}");

    loop {
        let (tcp, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(e) => {
                // A transient EMFILE must not kill live-streaming until restart.
                tracing::warn!("ws accept error: {e}");
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                continue;
            }
        };

        // Bound concurrent ffmpeg processes with the same semaphore /upload uses. (C6)
        let permit = match state.job_sem.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => { tracing::warn!("ws capacity reached, rejecting {peer}"); continue; }
        };

        let state = state.clone();
        tokio::spawn(async move {
            let _permit = permit;

            let allowed_origin = cors_origin();
            let origin_check = move |req: &WsRequest, res: WsResponse| {
                let origin = req.headers().get("origin").and_then(|v| v.to_str().ok()).unwrap_or("");
                if origin != allowed_origin && !allowed_origin.is_empty() {
                    tracing::warn!("ws rejected origin: {origin}");
                    return Err(tokio_tungstenite::tungstenite::http::Response::builder()
                        .status(403)
                        .body(None)
                        .unwrap());
                }
                Ok(res)
            };

            let ws = match accept_hdr_async(tcp, origin_check).await {
                Ok(ws) => ws,
                Err(e) => { tracing::warn!("ws handshake from {peer}: {e}"); return; }
            };

            let id = Uuid::new_v4().to_string();
            tracing::info!("ws stream started: {id} from {peer}");

            let mut session = match stream_job::start_session(&id) {
                Ok(s) => s,
                Err(e) => { tracing::error!("stream session failed: {e}"); return; }
            };

            state.streams.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), session.output.clone());

            let (mut ws_tx, mut ws_rx) = ws.split();

            let _ = ws_tx.send(Message::Text(
                serde_json::json!({ "job_id": id }).to_string().into()
            )).await;

            while let Some(msg) = ws_rx.next().await {
                match msg {
                    Ok(Message::Binary(data)) => {
                        if stream_job::write_chunk(&mut session.stdin, &data).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }

            tracing::info!("ws stream ended: {id}");
            state.streams.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            stream_job::finish_session(id, session, &state.jobs, &state.db).await;
        });
    }
}
