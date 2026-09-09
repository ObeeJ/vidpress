//! Confines every client-supplied media path to the server's own storage dirs.
//!
//! Why this exists: `/upload`, `/analyze` and `/transcribe` all take a `path`
//! straight from the request body and hand it to ffmpeg/ffprobe/whisper. Those
//! binaries do not treat their input as a filesystem path — ffmpeg resolves
//! `http:`, `concat:`, `subfile:`, `data:` and friends as *protocols*. So an
//! unguarded `path` is simultaneously an arbitrary-file-read and a full SSRF
//! primitive. Everything user-supplied must come through `resolve_input`.

use std::path::{Component, Path, PathBuf};

use crate::state::{storage_dir, ALLOWED_EXTS};

/// Directory that `/ingest` writes into. Kept separate from `storage_dir()`
/// (which holds *outputs*) so the two roots can diverge later.
pub fn ingest_dir() -> String {
    std::env::var("THEFLATE_INGEST_DIR").unwrap_or_else(|_| storage_dir())
}

#[derive(Debug, PartialEq)]
pub enum PathError {
    /// Contains `://`, or a bare `scheme:` that ffmpeg would treat as a protocol.
    ProtocolUrl,
    /// Escapes every permitted root after canonicalisation.
    OutsideRoot,
    /// Extension missing or not in `ALLOWED_EXTS`.
    BadExtension,
    /// Does not exist, or is not a regular file (blocks /dev/*, FIFOs, dirs).
    NotAFile,
}

impl PathError {
    /// Deliberately coarse — never echo the offending path back to the caller.
    pub fn public_message(&self) -> &'static str {
        match self {
            PathError::ProtocolUrl | PathError::OutsideRoot => "path not permitted",
            PathError::BadExtension => "unsupported file type",
            PathError::NotAFile => "file not found",
        }
    }
}

/// True if ffmpeg would read `raw` as a protocol rather than a local file.
///
/// ffmpeg's protocol detection looks for a `:` before the first `/`, so
/// `concat:a|b` and `http://x` both qualify while `/tmp/a:b.mp4` does not.
fn looks_like_protocol(raw: &str) -> bool {
    match raw.find(':') {
        None => false,
        Some(colon) => match raw.find('/') {
            Some(slash) if slash < colon => false,
            _ => true,
        },
    }
}

/// Reject `..` and absolute-root re-anchoring *before* touching the filesystem,
/// so a symlink race cannot turn a rejected path into an accepted one.
fn has_traversal(p: &Path) -> bool {
    p.components().any(|c| matches!(c, Component::ParentDir))
}

/// Canonicalise `candidate` and require it to sit inside one of `roots`.
///
/// `canonicalize` resolves symlinks, which is the point: an attacker who can
/// place a symlink inside the storage dir must not be able to aim it at `/etc`.
fn confine(candidate: &Path, roots: &[PathBuf]) -> Result<PathBuf, PathError> {
    let real = candidate.canonicalize().map_err(|_| PathError::NotAFile)?;
    if !real.is_file() {
        return Err(PathError::NotAFile);
    }
    for root in roots {
        // Compare canonical-to-canonical; a non-existent root can never match.
        if let Ok(real_root) = root.canonicalize() {
            if real.starts_with(&real_root) {
                return Ok(real);
            }
        }
    }
    Err(PathError::OutsideRoot)
}

/// The only sanctioned way to turn a client-supplied `path` into something
/// safe to pass to ffmpeg/ffprobe/whisper.
pub fn resolve_input(raw: &str) -> Result<String, PathError> {
    let raw = raw.trim();
    if looks_like_protocol(raw) {
        return Err(PathError::ProtocolUrl);
    }

    let candidate = Path::new(raw);
    if has_traversal(candidate) {
        return Err(PathError::OutsideRoot);
    }

    let ext = candidate
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or(PathError::BadExtension)?;
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(PathError::BadExtension);
    }

    let roots = vec![PathBuf::from(ingest_dir()), PathBuf::from(storage_dir())];
    let real = confine(candidate, &roots)?;
    real.to_str()
        .map(str::to_owned)
        .ok_or(PathError::OutsideRoot)
}

/// Validate a client-supplied `output_format` before it is interpolated into an
/// output filename. Without this, `output_format: "mp4/../../../etc/cron.d/x"`
/// makes ffmpeg write attacker-controlled bytes to an arbitrary path.
pub fn resolve_output_ext(raw: &str) -> Result<String, PathError> {
    let ext = raw.trim().to_lowercase();
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(PathError::BadExtension);
    }
    Ok(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_urls_are_rejected() {
        for raw in [
            "http://169.254.169.254/latest/meta-data/",
            "https://evil.test/x.mp4",
            "concat:/etc/passwd|/etc/shadow",
            "subfile:///etc/passwd",
            "data:video/mp4;base64,AAAA",
        ] {
            assert!(looks_like_protocol(raw), "should be protocol: {raw}");
        }
    }

    #[test]
    fn plain_paths_are_not_protocols() {
        for raw in ["/tmp/theflate_a.mp4", "./rel.mp4", "/tmp/odd:name.mp4"] {
            assert!(!looks_like_protocol(raw), "should be a path: {raw}");
        }
    }

    #[test]
    fn traversal_is_rejected_before_touching_disk() {
        assert!(has_traversal(Path::new("/tmp/out/../../etc/passwd")));
        assert!(!has_traversal(Path::new("/tmp/out/a.mp4")));
    }

    #[test]
    fn resolve_input_rejects_protocols_and_traversal() {
        assert_eq!(resolve_input("http://x/y.mp4"), Err(PathError::ProtocolUrl));
        assert_eq!(
            resolve_input("/tmp/theflate_out/../../etc/passwd.mp4"),
            Err(PathError::OutsideRoot)
        );
    }

    #[test]
    fn resolve_input_rejects_disallowed_and_missing_extensions() {
        assert_eq!(resolve_input("/tmp/x.sh"), Err(PathError::BadExtension));
        assert_eq!(resolve_input("/tmp/noext"), Err(PathError::BadExtension));
    }

    #[test]
    fn output_ext_allowlist() {
        assert_eq!(resolve_output_ext("MP4").unwrap(), "mp4");
        assert_eq!(
            resolve_output_ext("mp4/../../etc/cron.d/x"),
            Err(PathError::BadExtension)
        );
        assert_eq!(resolve_output_ext("exe"), Err(PathError::BadExtension));
    }

    #[test]
    fn error_messages_never_echo_input() {
        assert_eq!(PathError::ProtocolUrl.public_message(), "path not permitted");
        assert_eq!(PathError::OutsideRoot.public_message(), "path not permitted");
    }
}
