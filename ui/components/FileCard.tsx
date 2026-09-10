"use client";

import { useEffect, useRef, useState } from "react";
import { useStore, FileItem } from "@/lib/store";
import { ingestFile, analyzeFile, uploadFile, downloadFile, getJob, transcribeFile, getTranscription, exportToDestination, API } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { toast, toastError } from "@/lib/toast";
import Button from "@/components/primitives/Button";
import CountUp from "@/components/CountUp";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

const PRESETS = [
  { id: "original", label: "Original", desc: "Max quality ratio" },
  { id: "web", label: "Web", desc: "Optimised for browsers" },
  { id: "whatsapp", label: "WhatsApp", desc: "Under 16MB cap" },
  { id: "instagram_reel", label: "Instagram", desc: "9:16 Vertical" },
  { id: "twitter", label: "Twitter/X", desc: "Optimised for X" },
];

const DESTINATIONS = [
  { id: "s3", name: "AWS S3 Bucket", placeholder: "my-s3-media-bucket" },
  { id: "r2", name: "Cloudflare R2", placeholder: "my-r2-bucket" },
  { id: "supabase", name: "Supabase Storage", placeholder: "my-supabase-bucket" },
  { id: "gdrive", name: "Google Drive", placeholder: "Google Drive Folder" },
  { id: "dropbox", name: "Dropbox", placeholder: "Dropbox Folder" },
];

function fmt(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmtTime(secs: number) {
  if (!secs || secs <= 0) return "instant";
  if (secs < 5) return "a few seconds";
  if (secs < 60) return `~${secs}s`;
  if (secs < 3600) return `~${Math.round(secs / 60)}m`;
  return `~${(secs / 3600).toFixed(1)}h`;
}

function kindIcon(kind: string) {
  if (kind?.includes("audio")) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  if (kind?.includes("image")) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

const stat = (label: string, value: string, colorVar?: string) => (
  <div className="fc-stat">
    <span className="fc-stat-value" style={colorVar ? { color: colorVar } : undefined}>{value}</span>
    <span className="fc-stat-label">{label}</span>
  </div>
);

export default function FileCard({ item }: { item: FileItem }) {
  const { setProfile, setJobId, setJob, setError, removeFile, networkMbps } = useStore();
  const setIngestId = useStore((s) => s.setIngestId);
  const setUploadPct = useStore((s) => s.setUploadPct);
  const setTargetMb = useStore((s) => s.setTargetMb);
  const setPreset = useStore((s) => s.setPreset);
  const setOutputFormat = useStore((s) => s.setOutputFormat);

  const [transcription, setTranscription] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportProvider, setExportProvider] = useState("s3");
  const [exportBucket, setExportBucket] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailsRef = useRef(0);

  // Ingest & analyze on mount
  useEffect(() => {
    if (item.profile || item.error || item.ingestId) return;
    ingestFile(item.file, (pct) => setUploadPct(item.localUrl, pct))
      .then((ingestId) => {
        setIngestId(item.localUrl, ingestId);
        return analyzeFile(ingestId);
      })
      .then((p) => setProfile(item.localUrl, p))
      .catch((e) => {
        const msg = e instanceof Error && e.message.length < 120 ? e.message.replace(/^Error:\s*/i, "") : "Upload failed. Check your file and try again.";
        setError(item.localUrl, msg);
        toastError(e, "Upload failed. Check your file and try again.");
      });
  }, [item.file, item.localUrl, item.profile, item.error, item.ingestId, setUploadPct, setIngestId, setProfile, setError]);

  // Poll job status
  useEffect(() => {
    if (!item.jobId || item.job?.status === "done" || item.job?.status === "failed") return;
    pollRef.current = setInterval(async () => {
      try {
        const job = await getJob(item.jobId!);
        pollFailsRef.current = 0;
        setJob(item.localUrl, job);
        if (job.status === "done" || job.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (job.status === "done") toast(`${item.file.name} compressed successfully`, "success");
          if (job.status === "failed") toast(`Compression failed for ${item.file.name}. Try a different preset or format.`, "error");
        }
      } catch {
        if (++pollFailsRef.current >= 5) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(item.localUrl, "Lost connection to the server. Refresh and try again.");
        }
      }
    }, 800);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [item.jobId, item.job?.status, item.file.name, item.localUrl, setJob, setError]);

  const profile = item.profile;
  const job = item.job;
  const originalMb = profile ? profile.size_bytes / 1048576 : 0;
  const minMb = profile ? Math.max(0.01, +(originalMb * 0.01).toFixed(2)) : 0;
  const targetMb = item.targetMb ?? profile?.estimated_output_mb ?? 0;
  // Mirrors MIN_BITS_PER_PIXEL in src/jobs/compress.rs::run - below this the
  // backend scales resolution down to hit the target size, so warn here
  // instead of letting it happen as a silent surprise.
  const belowQualityFloor = (() => {
    if (!profile?.width || !profile?.height || profile.duration_secs <= 0) return false;
    const videoKbps = Math.max(100, ((targetMb * 8 * 1024) / profile.duration_secs) - 128);
    const bitsPerPixel = (videoKbps * 1000) / (profile.width * profile.height * 30);
    return bitsPerPixel < 0.02;
  })();
  const savingPct = originalMb > 0 ? Math.round((1 - targetMb / originalMb) * 100) : 0;
  const downloadTimeSecs = networkMbps > 0 ? Math.ceil((targetMb * 8) / networkMbps) : 0;
  const costEstimate = targetMb ? `$${(targetMb * 0.01).toFixed(3)}` : "Free";
  const selectedPreset = item.preset ?? "original";
  const selectedFormat = item.outputFormat ?? profile?.output_ext ?? "";
  const outputUrl = job?.status === "done" ? `${API}/download/${job.id}` : null;
  const shareUrl = job?.status === "done" ? `${BASE_URL}/download/${job.id}` : null;

  async function theflate() {
    if (!item.ingestId) return;
    try {
      const { job_id } = await uploadFile(
        item.ingestId,
        selectedPreset === "original" ? undefined : selectedPreset,
        undefined,
        selectedFormat !== profile?.output_ext ? selectedFormat : undefined,
        selectedPreset === "original" ? targetMb : undefined,
      );
      setJobId(item.localUrl, job_id);
      toast("Compression started", "info");
    } catch (e) {
      const msg = e instanceof Error && e.message.length < 120 ? e.message.replace(/^Error:\s*/i, "") : "Couldn't start compression. Try again.";
      setError(item.localUrl, msg);
      toastError(e, "Couldn't start compression. Try again.");
    }
  }

  async function runTranscription() {
    if (!job?.id) return;
    setTranscribing(true);
    try {
      // Backend is async - returns {transcription_id}, not {text}. Poll until done.
      const { transcription_id } = await transcribeFile(job.id);
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const result = await getTranscription(transcription_id);
        if (result.status === "done") {
          setTranscription(result.text);
          toast("Transcription ready", "success");
          return;
        }
        if (result.status === "failed") throw new Error("Transcription failed");
      }
      throw new Error("Transcription timed out");
    } catch (e) {
      toastError(e, "Transcription failed. The audio may be too short or unclear.");
    } finally {
      setTranscribing(false);
    }
  }

  async function handleDestinationExport() {
    if (!job?.id) return;
    setExporting(true);
    try {
      const res = await exportToDestination(job.id, exportProvider, {
        bucket: exportBucket || "my-media-bucket",
        targetPath: `exports/${item.file.name}`,
      });
      setExportedUrl(res.remote_url);
      toast(`Exported directly to ${exportProvider.toUpperCase()}`, "success");
    } catch (e) {
      toastError(e, "Export failed. Check your bucket name and credentials.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fc-card">
      {/* Card Header */}
      <div className="fc-header">
        <div className="fc-header-id">
          {kindIcon(profile?.kind ?? "")}
          <span className="fc-header-name">
            {item.file.name}
          </span>
        </div>
        <div className="fc-header-right">
          {job?.status && (
            <span className="fc-badge" data-status={job.status}>
              {job.status}
            </span>
          )}
          <button
            onClick={() => removeFile(item.localUrl)}
            aria-label="Remove item"
            className="fc-close-btn"
          >
            ×
          </button>
        </div>
      </div>

      <div className="fc-body">
        {/* Error */}
        {item.error && (
          <div className="fc-error">
            {item.error}
          </div>
        )}

        {/* Upload & Analysis Progress */}
        {!profile && !item.error && (
          <div className="fc-progress-row">
            <div className="fc-progress-label">
              <span>{item.ingestId ? "Inspecting file..." : "Uploading..."}</span>
              {!item.ingestId && <span>{item.uploadPct ?? 0}%</span>}
            </div>
            <div className="fc-bar">
              <div
                className="fc-bar-fill"
                style={{
                  width: item.ingestId ? "100%" : `${item.uploadPct ?? 0}%`,
                  background: item.ingestId ? "var(--color-signal)" : "var(--color-fg)",
                }}
              />
            </div>
          </div>
        )}

        {/* Profile Stats */}
        {profile && (
          <div className="fc-stat-grid fc-stat-grid-4">
            {stat("Size", fmt(profile.size_bytes))}
            {stat("Format", profile.codec_name)}
            {profile.duration_secs > 0 ? stat("Duration", fmtTime(Math.round(profile.duration_secs))) : stat("Type", profile.kind)}
            {profile.width ? stat("Dimensions", `${profile.width}×${profile.height}`) : stat("Output", profile.output_ext.toUpperCase())}
          </div>
        )}

        {/* Format Picker */}
        {profile && !job && profile.available_formats?.length > 0 && (
          <div className="fc-progress-row">
            <span className="fc-section-label">Output Format</span>
            <div className="fc-pill-row">
              {profile.available_formats.map((fmtExt) => (
                <button
                  key={fmtExt}
                  onClick={() => setOutputFormat(item.localUrl, fmtExt)}
                  className="fc-pill fc-pill-format"
                  data-selected={selectedFormat === fmtExt}
                >
                  {fmtExt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Preset Selector */}
        {profile && !job && (
          <div className="fc-progress-row">
            <span className="fc-section-label">Quality Preset</span>
            <div className="fc-pill-row">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(item.localUrl, p.id)}
                  className="fc-pill"
                  data-selected={selectedPreset === p.id}
                >
                  <div>{p.label}</div>
                  <div className="fc-pill-desc">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Target Size Slider */}
        {profile && !job && selectedPreset === "original" && (
          <div className="fc-slider-row">
            <div className="fc-slider-header">
              <span className="fc-progress-label fc-label-inline">
                Target file size
                {belowQualityFloor && (
                  <span className="fc-info-icon" tabIndex={0} aria-label="Quality notice">
                    i
                    <span className="fc-tooltip" role="tooltip">
                      This size is smaller than the source resolution can cleanly support.
                      we&apos;ll automatically reduce the resolution to hit it. You can still
                      slide lower; quality will trade off further.
                    </span>
                  </span>
                )}
              </span>
              <div className="fc-slider-value">
                <span className="fc-stat-value">{targetMb.toFixed(1)} MB</span>
                <span className="fc-savings-badge">
                  {savingPct}%
                </span>
              </div>
            </div>
            <input
              type="range" min={minMb} max={originalMb} step={0.1} value={targetMb}
              onChange={(e) => setTargetMb(item.localUrl, Number(e.target.value))}
              className="fc-range"
            />
          </div>
        )}

        {/* Estimates */}
        {profile && !job && (
          <div className="fc-stat-grid fc-stat-grid-3">
            {stat("Est. Cost", costEstimate, "#10b981")}
            {stat("Compression Time", fmtTime(profile.estimated_time_secs))}
            {stat("Download Time", fmtTime(downloadTimeSecs))}
          </div>
        )}

        {/* Compress Button */}
        {profile && !job && (
          <Button variant="primary" onClick={theflate} className="fc-btn-full">
            Compress →
          </Button>
        )}

        {/* Processing State */}
        {job && job.status !== "done" && job.status !== "failed" && (
          <div className="fc-slider-row">
            <div className="fc-progress-label">
              <span>{job.status === "queued" ? "In queue..." : "Compressing..."}</span>
              <span>
                {job.status === "queued"
                  ? `ETA ${fmtTime(profile?.estimated_time_secs ?? 0)}`
                  : `${job.progress}% · ETA ${fmtTime(job.eta_secs > 0 ? job.eta_secs : profile?.estimated_time_secs ?? 0)}`}
              </span>
            </div>
            <div className="fc-bar fc-bar-lg">
              <div
                className="fc-bar-fill"
                style={{
                  width: job.progress > 0 ? `${job.progress}%` : "100%",
                  background: "var(--color-fg)",
                  transition: job.progress > 0 ? `width var(--dur-3) var(--ease-out)` : "none",
                  animation: job.progress === 0 ? "theflate-pulse 1.5s ease-in-out infinite" : "none",
                }}
              />
            </div>
          </div>
        )}

        {/* Done State */}
        {job?.status === "done" && (
          <div className="fc-progress-row fc-done-gap">
            {/* Contract gesture - the signature motion moment */}
            <div className="contract tabular fc-stat-grid fc-stat-grid-3">
              {stat("Original", fmt(job.original_bytes))}
              <div className="fc-stat">
                <span className="fc-stat-value fc-stat-signal">
                  <CountUp from={job.original_bytes} to={job.compressed_bytes} format={fmt} durationMs={560} />
                </span>
                <span className="fc-stat-label">Compressed</span>
              </div>
              {stat("Saved", `${(((job.original_bytes - job.compressed_bytes) / job.original_bytes) * 100).toFixed(1)}%`, "var(--color-signal)")}
            </div>

            {/* Media Preview */}
            {outputUrl && profile && (
              <div className="fc-media-frame">
                {profile.kind === "video" || profile.kind === "image_animated" ? (
                  <video src={outputUrl} controls crossOrigin="anonymous" />
                ) : profile.kind?.includes("audio") ? (
                  <audio src={outputUrl} controls crossOrigin="anonymous" />
                ) : (
                  <img src={outputUrl} alt="preview" />
                )}
              </div>
            )}

            {/* Transcription */}
            {(profile?.kind === "video" || profile?.kind?.includes("audio")) && (
              <div className="fc-panel">
                <div className="fc-panel-header">
                  <div className="fc-panel-title">Transcribe</div>
                  <Button variant="secondary" size="sm" onClick={runTranscription} disabled={transcribing}>
                    {transcribing ? "Transcribing..." : transcription ? "Redo" : "Generate"}
                  </Button>
                </div>
                {transcription && (
                  <div className="fc-transcript-box">
                    {transcription}
                  </div>
                )}
              </div>
            )}

            {/* Cloud Export */}
            <div className="fc-panel">
              <div className="fc-panel-header">
                <div>
                  <div className="fc-panel-title">Export to Cloud Storage</div>
                  <div className="fc-panel-desc">Send your file to AWS S3, Cloudflare R2, Supabase, Google Drive, or Dropbox</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setShowExport(!showExport)}>
                  {showExport ? "Hide Target" : "Configure Destination"}
                </Button>
              </div>
              {showExport && (
                <div className="fc-progress-row fc-pt-1">
                  <div className="fc-pill-row">
                    {DESTINATIONS.map((dest) => (
                      <button
                        key={dest.id}
                        onClick={() => setExportProvider(dest.id)}
                        className="fc-pill fc-pill-format fc-pill-no-transform"
                        data-selected={exportProvider === dest.id}
                      >
                        {dest.name}
                      </button>
                    ))}
                  </div>
                  <div className="fc-export-row">
                    <input
                      value={exportBucket}
                      onChange={(e) => setExportBucket(e.target.value)}
                      placeholder={DESTINATIONS.find((d) => d.id === exportProvider)?.placeholder ?? "target-name"}
                      className="fc-export-input"
                    />
                    <Button variant="primary" size="sm" onClick={handleDestinationExport} disabled={exporting}>
                      {exporting ? "Exporting..." : "Send File"}
                    </Button>
                  </div>
                  {exportedUrl && (
                    <div className="fc-export-success">
                      Successfully exported: <a href={exportedUrl} target="_blank" rel="noreferrer" className="fc-export-link">{exportedUrl}</a>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="fc-actions">
              <Button variant="secondary" onClick={() => setShowQrModal(!showQrModal)}>
                {showQrModal ? "Hide QR Code" : "QR Share"}
              </Button>
              {outputUrl && (
                <Button
                  variant="primary"
                  onClick={() => downloadFile(job!.id, `theflated_${item.file.name}`)}
                >
                  Download
                </Button>
              )}
            </div>

            {/* QR Modal */}
            {showQrModal && shareUrl && (
              <div className="fc-qr-box">
                <span className="fc-qr-hint">Scan camera to download on mobile device</span>
                <div className="fc-qr-frame">
                  <QRCodeSVG value={shareUrl} size={140} />
                </div>
                <span className="fc-qr-url">{shareUrl}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
