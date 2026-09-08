use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use rusqlite::params;
use crate::{auth::{auth_and_rate, generate_api_key}, state::AppState};

#[post("/keys")]
pub async fn create_key(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    if let Err(r) = auth_and_rate(&req, &state.db) { return r; }

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return Response { status: 400, body: r#"{"error":"invalid json"}"#.into(), ..Default::default() },
    };
    let name      = body["name"].as_str().unwrap_or("unnamed").to_string();
    let plan      = "free"; // always free — plan upgrades go through Stripe webhook
    let webhook   = body["webhook_url"].as_str().map(String::from);
    let wl_domain = body["white_label_domain"].as_str().map(String::from);
    let wl_brand  = body["white_label_brand"].as_str().map(String::from);
    let key       = generate_api_key();

    // Single lock scope — avoids the double-lock deadlock (B3)
    {
        let conn = state.db.lock().unwrap();
        if let Some(ref domain) = wl_domain {
            let exists: bool = conn.query_row(
                "SELECT COUNT(*) FROM api_keys WHERE white_label_domain=?1",
                params![domain], |r| r.get::<_, i64>(0),
            ).unwrap_or(0) > 0;
            if exists {
                return Response { status: 409, body: r#"{"error":"white-label domain already taken"}"#.into(), ..Default::default() };
            }
        }
        if let Err(e) = conn.execute(
            "INSERT INTO api_keys(key,name,plan,webhook_url,white_label_domain,white_label_brand) VALUES(?1,?2,?3,?4,?5,?6)",
            params![key, name, plan, webhook, wl_domain, wl_brand],
        ) {
            tracing::error!("create_key insert failed: {e}");
            return Response { status: 500, body: r#"{"error":"internal error"}"#.into(), ..Default::default() };
        }
    }
    Response { status: 201, body: serde_json::json!({ "key": key, "name": name, "plan": plan }).to_string().into(), ..Default::default() }
}
