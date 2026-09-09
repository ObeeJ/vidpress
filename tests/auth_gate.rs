use theflate::auth::{generate_api_key, hash_key};

#[test]
fn stored_keys_are_hashed_not_plaintext() {
    let k = generate_api_key();
    let h = hash_key(&k);
    assert_ne!(h, k, "key stored verbatim");
    assert_eq!(h.len(), 64, "expected hex sha256");
    assert_eq!(hash_key(&k), h, "hash must be deterministic");
}
