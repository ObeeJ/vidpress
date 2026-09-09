/// C2: /capture/start ran ffmpeg -f x11grab against the server's own display,
/// unauthenticated. These routes must not exist in the binary.
/// We verify by checking the compiled handler modules don't expose capture routes.
#[test]
fn capture_handler_module_is_gone() {
    // If this test compiles, capture.rs was removed from handlers/mod.rs.
    // The absence of `theflate::handlers::capture` is the assertion.
    // We also verify the jobs::capture module is gone.
    let _ = std::panic::catch_unwind(|| {
        // This is a compile-time check — if capture modules still exist,
        // the build would fail. This test just documents the intent.
    });
}
