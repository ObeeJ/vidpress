use glideapi::{Request, Response};
use rusqlite::params;
use serde::Serialize;
use crate::state::Db;

#[derive(Debug, Clone, Serialize)]
pub struct ApiKey {
    pub key: String,
    pub name: String,
    pub plan: String,
    pub webhook_url: Option<String>,
}

pub fn generate_api_key() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.gen::<u8>()).collect();
    format!("vp_{}", hex::encode_upper(&bytes))
}

pub fn lookup_api_key(db: &Db, key: &str) -> Option<ApiKey> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT key,name,plan,webhook_url FROM api_keys WHERE key=?1",
        params![key],
        |r| Ok(ApiKey {
            key:         r.get(0)?,
            name:        r.get(1)?,
            plan:        r.get(2)?,
            webhook_url: r.get(3)?,
        }),
    ).ok()
}

pub fn extract_ip(req: &Request) -> String {
    let trust_proxy = std::env::var("VIDPRESS_TRUST_PROXY").as_deref() == Ok("1");
    if trust_proxy {
        if let Some(fwd) = req.headers.get("x-forwarded-for") {
            let ip = fwd.split(',').next().unwrap_or(fwd).trim().to_string();
            if !ip.is_empty() { return ip; }
        }
        if let Some(real) = req.headers.get("x-real-ip") {
            return real.clone();
        }
    }
    "127.0.0.1".into()
}

pub fn rate_check(db: &Db, ip: &str, limit: u32) -> bool {
    let conn = db.lock().unwrap();
    let window = now_secs() - 60;
    conn.execute("DELETE FROM rate_limit WHERE ts < ?1", params![window]).ok();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM rate_limit WHERE ip=?1 AND ts>=?2",
        params![ip, window], |r| r.get(0),
    ).unwrap_or(0);
    if count >= limit as i64 { return false; }
    conn.execute("INSERT INTO rate_limit(ip,ts) VALUES(?1,?2)", params![ip, now_secs()]).ok();
    true
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn auth_and_rate(req: &Request, db: &Db) -> Result<Option<ApiKey>, Response> {
    if let Some(key) = req.headers.get("x-api-key") {
        match lookup_api_key(db, key.trim()) {
            Some(ak) => {
                let limit = match ak.plan.as_str() {
                    "premium"    => 300,
                    "api_starter"=> 120,
                    "api_growth" => 600,
                    "api_scale" | "whitelabel" => 3000,
                    _            => 60,
                };
                if !rate_check(db, &extract_ip(req), limit) {
                    return Err(Response { status: 429, body: r#"{"error":"rate limit exceeded"}"#.into(), ..Default::default() });
                }
                Ok(Some(ak))
            }
            None => Err(Response { status: 401, body: r#"{"error":"invalid api key"}"#.into(), ..Default::default() }),
        }
    } else {
        let ip = extract_ip(req);
        if !rate_check(db, &ip, 10) {
            return Err(Response { status: 429, body: r#"{"error":"rate limit exceeded — get an API key for higher limits"}"#.into(), ..Default::default() });
        }
        Ok(None)
    }
}
