//! Container/codec compatibility.
//!
//! A media file is two independent choices: the container (the `.mp4` or
//! `.webm` box) and the codecs packed inside it. ffmpeg will happily let you
//! pair them incorrectly and only fails when the muxer writes its header -
//! which, in a two-pass encode, is *after* pass 1 has already burned minutes of
//! CPU. That is how a webm upload could sit at 0% for five minutes and then
//! die with "Only VP8 or VP9 or AV1 video ... are supported for WebM".
//!
//! The mismatch has three dimensions, and fixing only the first still fails:
//!   - video codec  (webm rejects H.265/H.264)
//!   - audio codec  (webm rejects AAC; it wants Opus or Vorbis)
//!   - muxer flags  (`-movflags +faststart` is MP4-family only)
//!
//! So a codec choice here carries all three, and the table below is the single
//! source of truth for what may be combined with what.

/// Rough encode cost, used to describe options to a caller rather than to
/// drive any logic. AV1 being `Slow` is the honest label: SVT-AV1 at preset 6
/// is several times slower than x265 at `medium` for similar quality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Speed {
    Fast,
    Balanced,
    Slow,
}

/// One legal way to encode into a given container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct CodecChoice {
    /// Stable identifier used by the API and persisted with the job. Never
    /// rename these - clients send them back.
    pub id: &'static str,
    /// ffmpeg video encoder name (`-c:v`).
    pub video: &'static str,
    /// Value for `-preset`. x264/x265 take words ("medium"), SVT-AV1 takes
    /// numbers, which is why this is a string rather than an enum.
    pub preset: &'static str,
    /// ffmpeg audio encoder name (`-c:a`) valid inside this container.
    pub audio: &'static str,
    /// Whether `-movflags +faststart` applies. True only for the MP4 family;
    /// passing it to a WebM or Matroska muxer is meaningless.
    pub faststart: bool,
    /// Human-facing label for the picker.
    pub label: &'static str,
    pub speed: Speed,
}

// "faster" rather than x264/x265's "medium" default. Preset controls how hard
// the encoder searches for a smaller encoding, and the curve is steeply
// diminishing: medium costs roughly twice the CPU of faster for a difference
// most viewers cannot see. Combined with two-pass - which encodes the whole
// video once before producing a single frame of output - medium made even
// short clips take minutes to show any result.
const H264: CodecChoice = CodecChoice {
    id: "h264",
    video: "libx264",
    preset: "faster",
    audio: "aac",
    faststart: true,
    label: "H.264 - fastest, plays everywhere",
    speed: Speed::Fast,
};

const H265: CodecChoice = CodecChoice {
    id: "h265",
    video: "libx265",
    preset: "faster",
    audio: "aac",
    faststart: true,
    label: "H.265 - smaller files, modern players",
    speed: Speed::Balanced,
};

const AV1_MP4: CodecChoice = CodecChoice {
    id: "av1",
    video: "libsvtav1",
    preset: "6",
    audio: "aac",
    faststart: true,
    label: "AV1 - smallest files, slow to encode",
    speed: Speed::Slow,
};

const AV1_WEBM: CodecChoice = CodecChoice {
    id: "av1",
    video: "libsvtav1",
    preset: "6",
    audio: "libopus",
    faststart: false,
    label: "AV1 - smallest files, slow to encode",
    speed: Speed::Slow,
};

const VP9: CodecChoice = CodecChoice {
    id: "vp9",
    video: "libvpx-vp9",
    // libvpx has no -preset; -cpu-used is its speed dial and is appended by the
    // caller. "balanced" here is descriptive only and is never passed to
    // ffmpeg for this codec.
    preset: "balanced",
    audio: "libopus",
    faststart: false,
    label: "VP9 - balanced, native to WebM",
    speed: Speed::Balanced,
};

// Order is significant: element 0 is the container's default. HEVC leads
// wherever it is legal because this is a compression product and H.265 reaches
// a given quality in meaningfully fewer bytes than H.264 - which is also the
// behaviour that predated this module, when every target-size job hardcoded
// libx265. Only WebM's default changes, because HEVC was never muxable there.
const MKV_CHOICES: &[CodecChoice] = &[H265, H264, AV1_MP4, VP9];
const MP4_CHOICES: &[CodecChoice] = &[H265, H264, AV1_MP4];
const WEBM_CHOICES: &[CodecChoice] = &[VP9, AV1_WEBM];
const AVI_CHOICES: &[CodecChoice] = &[H264];

/// QuickTime is deliberately *not* MP4 here. AV1-in-MOV is nominally
/// standardised, but ffmpeg's mov muxer refuses it ("Could not write header
/// (incorrect codec parameters ?)"), so advertising it would recreate the very
/// bug this module exists to prevent - an option the API offers and the
/// encoder cannot deliver. Caught by tests/codec_matrix_muxes.rs.
const MOV_CHOICES: &[CodecChoice] = &[H265, H264];

/// Every codec legal inside `ext`, best default first.
///
/// Matroska accepts essentially anything, so it lists the full set. AVI is
/// deliberately restricted to H.264 - it technically accepts more, but the
/// combinations that play reliably are few and this is not a format worth
/// expanding support for.
pub fn codecs_for(ext: &str) -> &'static [CodecChoice] {
    match ext.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => MP4_CHOICES,
        "mov" => MOV_CHOICES,
        "webm" => WEBM_CHOICES,
        "mkv" => MKV_CHOICES,
        "avi" => AVI_CHOICES,
        // An unknown container is treated as MP4, matching detect.rs, which
        // falls back to "mp4" for any extension it does not recognise.
        _ => MP4_CHOICES,
    }
}

/// What `resolve` decided, so the caller can tell the user when their request
/// could not be honoured verbatim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    /// The requested codec (or the container default, when none was requested)
    /// is valid here.
    Exact(CodecChoice),
    /// The request was incompatible with the container and was replaced.
    /// `requested` is echoed back so the message can name it.
    Substituted {
        chosen: CodecChoice,
        requested: String,
    },
}

impl CodecChoice {
    /// The encoder-specific speed arguments.
    ///
    /// Not every encoder spells this the same way, and getting it wrong is a
    /// hard failure rather than a fallback: libvpx has no `-preset` at all and
    /// ffmpeg exits with "Unrecognized option" if handed one. Its speed dial
    /// is `-cpu-used` (0 slowest/best .. 8 fastest), and `-row-mt 1` enables
    /// row-based multithreading, without which VP9 barely uses more than one
    /// core. Keeping this next to the codec table means a call site cannot get
    /// the pairing wrong.
    pub fn preset_args(&self) -> Vec<String> {
        if self.video == "libvpx-vp9" {
            vec![
                "-cpu-used".into(),
                "2".into(),
                "-row-mt".into(),
                "1".into(),
            ]
        } else {
            vec!["-preset".into(), self.preset.into()]
        }
    }
}

impl Resolution {
    pub fn choice(&self) -> CodecChoice {
        match self {
            Resolution::Exact(c) => *c,
            Resolution::Substituted { chosen, .. } => *chosen,
        }
    }

    /// A sentence for the user when their codec was overridden, or None when
    /// the request was honoured exactly.
    pub fn notice(&self, ext: &str) -> Option<String> {
        match self {
            Resolution::Exact(_) => None,
            Resolution::Substituted { chosen, requested } => Some(format!(
                "{requested} cannot be stored in a .{ext} file, so {} was used instead.",
                chosen.id
            )),
        }
    }
}

/// Pick a codec that is guaranteed to mux into `ext`.
///
/// `requested` is honoured when legal; otherwise the container's default wins.
/// This never returns an invalid pairing, which is the whole point: callers
/// cannot construct the combination that used to fail at header-write time.
pub fn resolve(ext: &str, requested: Option<&str>) -> Resolution {
    let choices = codecs_for(ext);
    // `choices` is never empty for any branch of `codecs_for`, including its
    // catch-all, so indexing 0 as the default is safe.
    let default = choices[0];

    match requested {
        None => Resolution::Exact(default),
        Some(req) => {
            let req_norm = normalise_codec_id(req);
            match choices.iter().find(|c| c.id == req_norm) {
                Some(found) => Resolution::Exact(*found),
                None => Resolution::Substituted {
                    chosen: default,
                    requested: req_norm,
                },
            }
        }
    }
}

/// Map the aliases users and env vars actually supply onto canonical ids.
/// `THEFLATE_CODEC` has historically accepted both `h264` and `libx264`.
fn normalise_codec_id(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "h264" | "libx264" | "avc" | "x264" => "h264",
        "h265" | "libx265" | "hevc" | "x265" => "h265",
        "av1" | "libsvtav1" | "svtav1" | "svt-av1" => "av1",
        "vp9" | "libvpx-vp9" | "vp09" => "vp9",
        other => return other.to_string(),
    }
    .to_string()
}

/// The codec named by `THEFLATE_CODEC`, if any. Returning None (rather than a
/// hardcoded default) lets `resolve` apply the *container's* default, which is
/// what stops an operator setting THEFLATE_CODEC=h265 from breaking every webm
/// job in the deployment.
pub fn env_codec_preference() -> Option<String> {
    std::env::var("THEFLATE_CODEC")
        .ok()
        .map(|v| normalise_codec_id(&v))
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact production failure: HEVC requested for a WebM output. Before
    /// the compatibility layer this pairing reached ffmpeg and died at header
    /// write after pass 1 had already run.
    #[test]
    fn webm_never_resolves_to_hevc() {
        let r = resolve("webm", Some("h265"));
        assert!(matches!(r, Resolution::Substituted { .. }));
        let c = r.choice();
        assert_ne!(c.video, "libx265");
        assert!(matches!(c.video, "libvpx-vp9" | "libsvtav1"));
    }

    /// Audio is the second dimension of the same bug: AAC is as invalid inside
    /// WebM as HEVC is, so no webm choice may carry it.
    #[test]
    fn webm_choices_never_use_aac() {
        for c in codecs_for("webm") {
            assert_ne!(c.audio, "aac", "{} pairs AAC with WebM", c.id);
            assert!(!c.faststart, "{} sets a faststart flag on WebM", c.id);
        }
    }

    /// Every advertised option must be muxable, or the picker would offer users
    /// a combination that fails minutes later.
    #[test]
    fn every_advertised_choice_is_valid_for_its_container() {
        for ext in ["mp4", "m4v", "mov", "webm", "mkv", "avi"] {
            for c in codecs_for(ext) {
                match ext {
                    "webm" => {
                        assert!(matches!(c.video, "libvpx-vp9" | "libsvtav1"));
                        assert!(matches!(c.audio, "libopus" | "libvorbis"));
                    }
                    "mp4" | "m4v" | "mov" => {
                        assert!(matches!(c.video, "libx264" | "libx265" | "libsvtav1"));
                        assert_eq!(c.audio, "aac");
                    }
                    _ => {}
                }
            }
        }
    }

    #[test]
    fn requested_codec_is_honoured_when_legal() {
        assert_eq!(resolve("mp4", Some("h265")).choice().video, "libx265");
        assert_eq!(resolve("webm", Some("av1")).choice().video, "libsvtav1");
        assert_eq!(resolve("webm", Some("vp9")).choice().video, "libvpx-vp9");
    }

    #[test]
    fn aliases_normalise() {
        assert_eq!(resolve("mp4", Some("libx265")).choice().id, "h265");
        assert_eq!(resolve("mp4", Some("HEVC")).choice().id, "h265");
        assert_eq!(resolve("webm", Some("svt-av1")).choice().id, "av1");
    }

    /// An unknown codec must not silently become an invalid pairing; it falls
    /// back to the container default and reports the substitution.
    #[test]
    fn unknown_codec_falls_back_and_reports() {
        let r = resolve("mp4", Some("nonsense"));
        assert!(matches!(r, Resolution::Substituted { .. }));
        assert!(r.notice("mp4").unwrap().contains("nonsense"));
    }

    #[test]
    fn exact_resolution_has_no_notice() {
        assert!(resolve("mp4", Some("h264")).notice("mp4").is_none());
        assert!(resolve("webm", None).notice("webm").is_none());
    }

    /// codecs_for must never hand back an empty slice, since resolve indexes
    /// element 0 as the default.
    /// VP9 must never be handed -preset: ffmpeg rejects the option outright,
    /// which would turn the webm fix into a different webm failure.
    /// Pins the container defaults. Reordering the tables silently changes
    /// what every existing job encodes to - an earlier version of this module
    /// put H.264 first and quietly downgraded MP4 output from HEVC, which
    /// tests/target_mb_two_pass.rs caught.
    #[test]
    fn container_defaults_are_pinned() {
        assert_eq!(resolve("mp4", None).choice().id, "h265");
        assert_eq!(resolve("m4v", None).choice().id, "h265");
        assert_eq!(resolve("mov", None).choice().id, "h265");
        assert_eq!(resolve("mkv", None).choice().id, "h265");
        assert_eq!(resolve("avi", None).choice().id, "h264");
        // WebM is the sole intentional change: HEVC was never valid here.
        assert_eq!(resolve("webm", None).choice().id, "vp9");
    }

    /// AV1-in-MOV builds an ffmpeg command the mov muxer rejects, so it must
    /// not be advertised. Proven against real ffmpeg in
    /// tests/codec_matrix_muxes.rs.
    #[test]
    fn mov_does_not_offer_av1() {
        assert!(codecs_for("mov").iter().all(|c| c.id != "av1"));
    }

    #[test]
    fn vp9_gets_cpu_used_not_preset() {
        let vp9 = resolve("webm", Some("vp9")).choice();
        let args = vp9.preset_args();
        assert!(!args.contains(&"-preset".to_string()));
        assert!(args.contains(&"-cpu-used".to_string()));
        assert!(args.contains(&"-row-mt".to_string()));
    }

    #[test]
    fn preset_based_encoders_still_get_preset() {
        for (ext, id) in [("mp4", "h265"), ("mp4", "h264"), ("webm", "av1")] {
            let args = resolve(ext, Some(id)).choice().preset_args();
            assert_eq!(args[0], "-preset", "{id} lost its -preset");
            assert!(!args[1].is_empty());
        }
    }

    /// preset_args must always come in flag/value pairs or the ffmpeg command
    /// line silently shifts and misbinds every argument after it.
    #[test]
    fn preset_args_are_well_formed_pairs() {
        for ext in ["mp4", "webm", "mkv", "avi"] {
            for c in codecs_for(ext) {
                let args = c.preset_args();
                assert!(args.len() % 2 == 0, "{} produced odd args", c.id);
                assert!(args[0].starts_with('-'), "{} args must start with a flag", c.id);
            }
        }
    }

    #[test]
    fn no_container_has_an_empty_choice_list() {
        for ext in ["mp4", "webm", "mkv", "avi", "mov", "m4v", "weird", ""] {
            assert!(!codecs_for(ext).is_empty(), "{ext} had no codecs");
        }
    }
}
