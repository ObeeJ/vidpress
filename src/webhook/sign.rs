use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Produce a `t=<ts>,v1=<hex>` signature string. The timestamp is inside the
/// signed material so an old body cannot be replayed.
pub fn signature(secret: &str, body: &str, ts: i64) -> String {
    let signed = format!("{ts}.{body}");
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(signed.as_bytes());
    let result = mac.finalize().into_bytes();
    format!("t={ts},v1={}", hex::encode(result))
}
