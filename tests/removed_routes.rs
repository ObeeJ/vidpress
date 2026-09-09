/// C2: /capture/start ran ffmpeg -f x11grab against the server's own display,
/// unauthenticated. These routes must not exist in the binary.
///
/// This checks the live route registry glideapi builds at startup
/// (`glideapi::ROUTES`, populated by the `#[get]`/`#[post]` macros via
/// `linkme` distributed slices) — not just "does the crate compile". A
/// previous version of this test only wrapped an empty closure in
/// `catch_unwind` and asserted nothing; it passed whether or not the routes
/// existed.
#[test]
fn capture_routes_are_not_registered() {
    let registered: Vec<&str> = glideapi::ROUTES.iter().map(|r| r.path).collect();
    assert!(
        !registered.iter().any(|p| p.starts_with("/capture")),
        "capture routes still registered: {registered:?}"
    );
}
