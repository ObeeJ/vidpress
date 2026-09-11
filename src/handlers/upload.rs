use glideapi::{FromRequest, Request, Response, State};
use glideapi_macros::post;
use uuid::Uuid;
use crate::{
    auth::auth_and_rate,
    db::upsert_job,
    handlers::analyze::json_err,
    jobs::model::{DestinationConfig, Job, JobStatus},
    media::{detect::detect_with_hw, ffmpeg_args::format_ffmpeg_args, path_guard::resolve_output_ext},
    state::{AppState, storage_dir},
};

#[post("/upload")]
pub async fn upload(req: Request) -> Response {
    let State(state) = State::<AppState>::from_request(&req).unwrap();
    let caller = match auth_and_rate(&req, &state.db) { Ok(c) => c, Err(r) => return r };

    let body: serde_json::Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => return json_err(400, "invalid json"),
    };
    let ingest_id = match body["ingest_id"].as_str() {
        Some(s) => s,
        None => return json_err(400, "missing ingest_id"),
    };
    let path = match crate::ingest_store::resolve(
        &state.db, ingest_id, caller.as_ref().map(|k| k.key.as_str())
    ) {
        Some(p) => p,
        None => return json_err(404, "unknown or expired ingest_id"),
    };

    let webhook_url   = body["webhook_url"].as_str().map(String::from);
    if let Some(ref wh) = webhook_url {
        if !crate::webhook::is_public_url(wh) {
            return json_err(400, "invalid or disallowed webhook_url");
        }
    }
    let preset        = body["preset"].as_str().map(String::from);
    let output_format = body["output_format"].as_str().map(String::from);
    let target_mb     = body["target_mb"].as_f64();
    let destination: Option<DestinationConfig> = serde_json::from_value(body["destination"].clone()).ok();

    let mut profile = match detect_with_hw(&path, &state.hw).await {
        Ok(p)  => p,
        Err(_) => return json_err(415, "unsupported media type"),
    };
    if let Some(ref fmt) = output_format {
        let ext = match resolve_output_ext(fmt) {
            Ok(e) => e,
            Err(_) => return json_err(400, "unsupported output format"),
        };
        profile.ffmpeg_args = format_ffmpeg_args(&profile.kind, &ext, &state.hw);
        profile.output_ext = ext;
    }

    if target_mb.is_some() && preset.is_none() && (profile.kind == crate::media::detect::MediaKind::Video || profile.kind == crate::media::detect::MediaKind::ImageAnimated) && state.hw != crate::state::HwEncoder::Nvenc {
        profile.estimated_time_secs *= 2;
    }

    // Predict what this target size will actually look like before spending any
    // CPU on it. Target-size compression is arithmetic - a size and a duration
    // fix the bitrate - so an impossible ask can be answered immediately rather
    // than after minutes of encoding that ends in a 144p result nobody wanted.
    //
    // `force` is the deliberate escape hatch: someone with a hard size limit
    // may genuinely accept an ugly file, and this refuses to make that decision
    // for them. It only ever blocks the Unusable tier; Poor still proceeds with
    // its warning attached.
    let force = body["force"].as_bool().unwrap_or(false);
    let quality = target_mb.map(|mb| {
        crate::media::quality::estimate(
            mb,
            profile.duration_secs,
            // Dimensions are u64 on the profile; the estimator works in u32,
            // which is ample for any real frame size.
            profile.width.map(|v| v as u32),
            profile.height.map(|v| v as u32),
            None,
        )
    });

    if let Some(ref q) = quality {
        if q.tier.should_block() && !force {
            return Response {
                status: 400,
                body: serde_json::json!({
                    "error": "target_too_small",
                    "message": q.warning.clone().unwrap_or_default(),
                    "min_recommended_mb": (q.min_recommended_mb * 10.0).round() / 10.0,
                    "predicted_height": q.output_height,
                    "predicted_video_kbps": q.video_kbps,
                    // Offering the alternatives here is the point: the caller
                    // can retry with a workable size, pick a more efficient
                    // codec, or repeat the request with force=true.
                    "codec_options": crate::media::codec_compat::codecs_for(&profile.output_ext),
                    "force_hint": "resend with \"force\": true to compress anyway",
                })
                .to_string()
                .into(),
                ..Default::default()
            };
        }
    }

    let id = Uuid::new_v4().to_string();
    let out_dir = storage_dir();
    std::fs::create_dir_all(&out_dir).ok();
    let output_path = format!("{}/{}_output.{}", out_dir, id, profile.output_ext);
    // Captured before `profile` is moved into the spawned job, so the response
    // can still report which codecs this container accepts.
    let output_ext = profile.output_ext.clone();
    let eta = profile.estimated_time_secs;
    let owner_key = caller.as_ref().map(|k| k.key.clone());

    let job = Job {
        id: id.clone(), status: JobStatus::Queued,
        media_kind: profile.kind.clone(),
        input_path: path.clone(), output_path: output_path.clone(),
        original_bytes: profile.size_bytes, compressed_bytes: 0,
        duration_secs: profile.duration_secs, progress: 0, eta_secs: eta,
        webhook_url, preset: preset.clone(), destination, remote_url: None,
        owner_key,
    };
    upsert_job(&state.db, &job);
    state.jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), job);

    let (jobs, db, id2, hw, sem) = (state.jobs.clone(), state.db.clone(), id.clone(), state.hw.clone(), state.job_sem.clone());
    tokio::spawn(async move {
        crate::jobs::compress::run(id2, path, output_path, profile, preset, target_mb, jobs, db, hw, sem).await;
    });

    // Built with serde_json rather than format! so a warning string containing
    // a quote or backslash cannot corrupt the payload.
    let mut payload = serde_json::json!({
        "job_id": id,
        "status": "queued",
        "estimated_time_secs": eta,
        // Which codecs this container can actually accept, so a client can
        // offer a real choice instead of guessing and failing at mux time.
        "codec_options": crate::media::codec_compat::codecs_for(&output_ext),
    });

    // A Poor-tier job proceeds, but the caller is told plainly what it will
    // look like rather than discovering it on playback.
    if let Some(q) = quality {
        payload["quality"] = serde_json::json!({
            "tier": q.tier,
            "predicted_height": q.output_height,
            "source_height": q.source_height,
            "predicted_video_kbps": q.video_kbps,
            "min_recommended_mb": (q.min_recommended_mb * 10.0).round() / 10.0,
            "warning": q.warning,
        });
    }

    Response {
        status: 202,
        body: payload.to_string().into(),
        ..Default::default()
    }
}
