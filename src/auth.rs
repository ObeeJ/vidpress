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

/// API keys are stored as SHA-256 hex, never verbatim. A database dump must
/// not hand over live credentials. (H9)
///
/// Unsalted SHA-256 is correct here: these are 128-bit random tokens, not
/// user-chosen secrets, so there is no dictionary to attack, and lookup must
/// remain a single indexed query.
pub fn hash_key(raw: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(raw.as_bytes()))
}

pub fn lookup_api_key(db: &Db, key: &str) -> Option<ApiKey> {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    conn.query_row(
        "SELECT key,name,plan,webhook_url FROM api_keys WHERE key=?1",
        params![hash_key(key)],
        |r| Ok(ApiKey {
            key:         r.get(0)?,
            name:        r.get(1)?,
            plan:        r.get(2)?,
            webhook_url: r.get(3)?,
        }),
    ).ok()
}

/// Number of reverse proxies in front of this process. Each one appends to
/// `X-Forwarded-For`, so the client's real address is the Nth entry from the
/// *right*. Anything further left was supplied by the client and is forgeable.
fn proxy_hops() -> usize {
    std::env::var("THEFLATE_PROXY_HOPS")
        .ok().and_then(|v| v.parse().ok())
        .unwrap_or(1)
}

pub fn extract_ip(req: &Request) -> String {
    let trust_proxy = std::env::var("THEFLATE_TRUST_PROXY").as_deref() == Ok("1");
    if trust_proxy {
        if let Some(fwd) = req.headers.get("x-forwarded-for") {
            // Read from the right. `nginx.conf:33` sets
            // `X-Forwarded-For $proxy_add_x_forwarded_for`, which *appends* the
            // peer address to whatever the client sent - so the leftmost entry
            // is entirely attacker-controlled. Taking it (as this function used
            // to) makes the rate limiter a no-op: every request can claim a
            // fresh IP just by setting a header.
            let hops = proxy_hops().max(1);
            let parts: Vec<&str> = fwd.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
            if let Some(ip) = parts.len().checked_sub(hops).and_then(|i| parts.get(i)) {
                return (*ip).to_string();
            }
            if let Some(first) = parts.first() {
                return (*first).to_string();
            }
        }
        if let Some(real) = req.headers.get("x-real-ip") {
            return real.trim().to_string();
        }
    }
    // Not behind a trusted proxy: we cannot see the peer address through the
    // framework, so every anonymous caller shares a single bucket. Strict by
    // design - the previous "127.0.0.1" had the same effect but read like a
    // real per-client limit.
    "unknown".into()
}

pub fn rate_check(db: &Db, ip: &str, limit: u32) -> bool {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
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

/// Requests per minute allowed for a given plan. Mirrors the published table in
/// README.md; anonymous callers get the `None` arm.
pub fn rate_limit_for(plan: Option<&str>) -> u32 {
    match plan {
        None                      => 10,   // anonymous, per IP
        Some("free")              => 60,
        Some("premium")           => 300,
        Some("api_starter")       => 120,
        Some("api_growth")        => 600,
        Some("api_scale")
        | Some("white_label")     => 3000,
        Some(_)                   => 60,   // unknown plan → treat as free
    }
}

#[allow(dead_code)]
fn err(status: u16, msg: &str) -> Response {
    Response {
        status,
        body: serde_json::json!({ "error": msg }).to_string().into(),
        ..Default::default()
    }
}

/*
 ===============================================================================
 BILLING, PRICING & AUTHENTICATION REQUIREMENT BLOCK
 ===============================================================================
 The functions below enforce API Key verification, Tiered Plan Billing, and
 Per-IP / Per-Key Rate Limiting buckets.

 To allow everyone to use theflate completely for free without API key checks
 or 429 rate limit throttles, the auth and rate enforcement block inside
 `auth_and_rate` has been bypassed below. Everyone receives free access.
 ===============================================================================
*/

pub fn auth_and_rate(req: &Request, db: &Db) -> Result<Option<ApiKey>, Response> {
    // --- FREE ACCESS BYPASS ---
    // Extract optional API key if presented (for owner identification)
    let presented = req.headers.get("x-api-key").map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        // Also accept ?api_key= for browser navigation (e.g. download links
        // where setting a header is impossible).
        .or_else(|| {
            req.query.split('&')
                .find_map(|p| p.strip_prefix("api_key="))
                .map(|v| v.to_string())
        });

    let key = match presented {
        Some(raw) => lookup_api_key(db, &raw),
        None => None,
    };

    /*
    // --- AUTHENTICATION & BILLING RATE-LIMIT CHECK (COMMENTED OUT FOR FREE ACCESS) ---
    // Uncomment this block to enforce strict API key authentication and 429 rate limits.
    let key = match presented {
        Some(raw) => match lookup_api_key(db, &raw) {
            Some(k) => Some(k),
            None => return Err(err(401, "invalid api key")),
        },
        None => None,
    };

    let bucket = match key {
        Some(ref k) => format!("key:{}", k.key),
        None        => format!("ip:{}", extract_ip(req)),
    };
    let limit = rate_limit_for(key.as_ref().map(|k| k.plan.as_str()));

    if !rate_check(db, &bucket, limit) {
        return Err(err(429, "rate limit exceeded"));
    }
    */

    // Allow all users free access
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_are_prefixed_and_unique() {
        let a = generate_api_key();
        let b = generate_api_key();
        assert!(a.starts_with("vp_"), "missing prefix: {a}");
        assert_eq!(a.len(), 3 + 32, "expected 16 bytes hex-encoded");
        assert_ne!(a, b);
    }

    #[test]
    fn plan_limits_match_published_table() {
        assert_eq!(rate_limit_for(None), 10);
        assert_eq!(rate_limit_for(Some("free")), 60);
        assert_eq!(rate_limit_for(Some("premium")), 300);
        assert_eq!(rate_limit_for(Some("api_scale")), 3000);
        // An unrecognised plan must degrade to the cheapest tier, never to
        // "unlimited".
        assert_eq!(rate_limit_for(Some("enterprise-negotiated")), 60);
    }
}
