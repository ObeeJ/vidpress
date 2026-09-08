use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;
use crate::{jobs::stream as stream_job, state::AppState};

pub async fn listen(state: Arc<AppState>) {
    let addr = "0.0.0.0:8081";
    let listener = TcpListener::bind(addr).await.expect("ws bind failed");
    tracing::info!("WebSocket stream endpoint on ws://{addr}");

    while let Ok((tcp, peer)) = listener.accept().await {
        let state = state.clone();
        tokio::spawn(async move {
            let ws = match accept_async(tcp).await {
                Ok(ws) => ws,
                Err(e) => { tracing::warn!("ws handshake from {peer}: {e}"); return; }
            };

            let id = Uuid::new_v4().to_string();
            tracing::info!("ws stream started: {id} from {peer}");

            let mut session = match stream_job::start_session(&id) {
                Ok(s) => s,
                Err(e) => { tracing::error!("stream session failed: {e}"); return; }
            };

            // Register output path immediately so /preview/:id can serve partial data
            state.streams.lock().unwrap().insert(id.clone(), session.output.clone());

            let (mut ws_tx, mut ws_rx) = ws.split();

            // Send the job id back to the client immediately
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
            state.streams.lock().unwrap().remove(&id);
            stream_job::finish_session(id, session, &state.jobs, &state.db).await;
        });
    }
}
