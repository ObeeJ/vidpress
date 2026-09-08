use crate::{media::detect::MediaKind, state::HwEncoder};

fn s(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

/// VAAPI filter chain prefix — upload to GPU, encode, download result.
fn vaapi_video(crf_equiv: &str) -> Vec<String> {
    s(&[
        "-vaapi_device", "/dev/dri/renderD128",
        "-vf", "format=nv12,hwupload",
        "-c:v", "h264_vaapi",
        "-qp", crf_equiv,          // VAAPI uses -qp instead of -crf
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
    ])
}

fn sw_video(crf: &str) -> Vec<String> {
    s(&["-c:v","libx264","-preset","fast","-crf",crf,"-c:a","aac","-b:a","128k","-movflags","+faststart"])
}

pub fn default_video_args(hw: &HwEncoder) -> Vec<String> {
    match hw {
        HwEncoder::Vaapi    => vaapi_video("23"),
        HwEncoder::Software => sw_video("23"),
    }
}

pub fn preset_ffmpeg_args(preset: &Option<String>, hw: &HwEncoder) -> Option<Vec<String>> {
    match preset.as_deref() {
        Some("whatsapp") => Some(match hw {
            HwEncoder::Vaapi => {
                let mut a = s(&["-vaapi_device","/dev/dri/renderD128","-vf","scale='min(1280,iw)':-2,format=nv12,hwupload","-c:v","h264_vaapi","-qp","28"]);
                a.extend(s(&["-c:a","aac","-b:a","96k","-movflags","+faststart"]));
                a
            }
            HwEncoder::Software => s(&[
                "-c:v","libx264","-preset","fast","-crf","28",
                "-vf","scale='min(1280,iw)':-2","-c:a","aac","-b:a","96k","-movflags","+faststart",
            ]),
        }),
        Some("instagram_reel") => Some(match hw {
            HwEncoder::Vaapi => {
                let mut a = s(&["-vaapi_device","/dev/dri/renderD128",
                    "-vf","scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=nv12,hwupload",
                    "-c:v","h264_vaapi","-qp","23"]);
                a.extend(s(&["-c:a","aac","-b:a","128k","-movflags","+faststart"]));
                a
            }
            HwEncoder::Software => s(&[
                "-c:v","libx264","-preset","fast","-crf","23",
                "-vf","scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
                "-c:a","aac","-b:a","128k","-movflags","+faststart",
            ]),
        }),
        Some("web") => Some(match hw {
            HwEncoder::Vaapi => {
                let mut a = s(&["-vaapi_device","/dev/dri/renderD128","-vf","scale='min(1920,iw)':-2,format=nv12,hwupload","-c:v","h264_vaapi","-qp","23"]);
                a.extend(s(&["-c:a","aac","-b:a","128k","-movflags","+faststart"]));
                a
            }
            HwEncoder::Software => s(&[
                "-c:v","libx264","-preset","fast","-crf","23",
                "-vf","scale='min(1920,iw)':-2","-c:a","aac","-b:a","128k","-movflags","+faststart",
            ]),
        }),
        Some("twitter") => Some(match hw {
            HwEncoder::Vaapi => {
                let mut a = s(&["-vaapi_device","/dev/dri/renderD128","-vf","scale='min(1280,iw)':-2,format=nv12,hwupload","-c:v","h264_vaapi","-qp","26"]);
                a.extend(s(&["-c:a","aac","-b:a","96k","-t","140","-movflags","+faststart"]));
                a
            }
            HwEncoder::Software => s(&[
                "-c:v","libx264","-preset","fast","-crf","26",
                "-vf","scale='min(1280,iw)':-2","-c:a","aac","-b:a","96k",
                "-t","140","-movflags","+faststart",
            ]),
        }),
        _ => None,
    }
}

pub fn format_ffmpeg_args(kind: &MediaKind, fmt: &str, hw: &HwEncoder) -> Vec<String> {
    match (kind, fmt) {
        (MediaKind::Video | MediaKind::ImageAnimated, "mp4"|"mov"|"m4v") => match hw {
            HwEncoder::Vaapi    => vaapi_video("23"),
            HwEncoder::Software => sw_video("23"),
        },
        (MediaKind::Video | MediaKind::ImageAnimated, "mkv") => match hw {
            HwEncoder::Vaapi    => { let mut a = vaapi_video("23"); a.retain(|x| x != "+faststart" && x != "-movflags"); a }
            HwEncoder::Software => s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k"]),
        },
        (MediaKind::Video | MediaKind::ImageAnimated, "webm") =>
            s(&["-c:v","libvpx-vp9","-crf","33","-b:v","0","-c:a","libopus","-b:a","128k"]),
        (MediaKind::Video | MediaKind::ImageAnimated, "avi") => match hw {
            HwEncoder::Vaapi    => { let mut a = vaapi_video("23"); a.retain(|x| x != "+faststart" && x != "-movflags"); a.extend(s(&["-c:a","mp3","-b:a","128k"])); a }
            HwEncoder::Software => s(&["-c:v","libx264","-preset","fast","-crf","23","-c:a","mp3","-b:a","128k"]),
        },
        (MediaKind::Video | MediaKind::ImageAnimated, "gif") =>
            s(&["-vf","fps=15,scale='min(480,iw)':-1:flags=lanczos","-loop","0"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "mp3")  => s(&["-c:a","libmp3lame","-b:a","192k","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "m4a")  => s(&["-c:a","aac","-b:a","192k","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "ogg")  => s(&["-c:a","libvorbis","-q:a","6","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "flac") => s(&["-c:a","flac","-vn"]),
        (MediaKind::AudioLossless | MediaKind::AudioLossy, "wav")  => s(&["-c:a","pcm_s16le","-vn"]),
        (MediaKind::ImageStatic, "jpg")  => s(&["-q:v","85"]),
        (MediaKind::ImageStatic, "png")  => s(&["-compression_level","6"]),
        (MediaKind::ImageStatic, "webp") => s(&["-q:v","80"]),
        _ => vec![],
    }
}
