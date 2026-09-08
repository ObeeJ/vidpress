"use client";

import { useEffect, useRef, useState } from "react";
import { useStore, FileItem } from "@/lib/store";
import { ingestFile, analyzeFile, uploadFile, downloadFile, getJob, transcribeFile, exportToDestination, API } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "@/lib/toast";

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

const stat = (label: string, value: string, color?: string) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <span style={{ fontSize: 14, fontWeight: 700, color: color ?? "#ffffff" }}>{value}</span>
    <span style={{ fontSize: 11, color: "#71717a" }}>{label}</span>
  </div>
);

export default function FileCard({ item }: { item: FileItem }) {
  const { setProfile, setJobId, setJob, setError, removeFile, networkMbps } = useStore();
  const setServerPath = useStore((s) => s.setServerPath);
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

  // Ingest & analyze on mount
  useEffect(() => {
    if (item.profile || item.error || item.serverPath) return;
    ingestFile(item.file, (pct) => setUploadPct(item.localUrl, pct))
      .then((path) => {
        setServerPath(item.localUrl, path);
        return analyzeFile(path);
      })
      .then((p) => setProfile(item.localUrl, p))
      .catch((e) => {
        setError(item.localUrl, `Upload failed: ${e}`);
        toast(`Upload failed: ${e}`, "error");
      });
  }, [item.file, item.localUrl, item.profile, item.error, item.serverPath, setUploadPct, setServerPath, setProfile, setError]);

  // Poll job status
  useEffect(() => {
    if (!item.jobId || item.job?.status === "done" || item.job?.status === "failed") return;
    pollRef.current = setInterval(async () => {
      try {
        const job = await getJob(item.jobId!);
        setJob(item.localUrl, job);
        if (job.status === "done" || job.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (job.status === "done") toast(`${item.file.name} theflated successfully`, "success");
          if (job.status === "failed") toast(`Failed to theflate ${item.file.name}`, "error");
        }
      } catch {
        // transient error — keep polling
      }
    }, 800);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [item.jobId, item.job?.status, item.file.name, item.localUrl, setJob]);

  const profile = item.profile;
  const job = item.job;
  const originalMb = profile ? profile.size_bytes / 1048576 : 0;
  const minMb = profile ? Math.max(0.01, +(originalMb * 0.01).toFixed(2)) : 0;
  const targetMb = item.targetMb ?? profile?.estimated_output_mb ?? 0;
  const savingPct = originalMb > 0 ? Math.round((1 - targetMb / originalMb) * 100) : 0;
  const downloadTimeSecs = networkMbps > 0 ? Math.ceil((targetMb * 8) / networkMbps) : 0;
  const costEstimate = targetMb ? `$${(targetMb * 0.01).toFixed(3)}` : "—";
  const selectedPreset = item.preset ?? "original";
  const selectedFormat = item.outputFormat ?? profile?.output_ext ?? "";
  const outputUrl = job?.status === "done" ? `${API}/download/${job.id}` : null;
  const shareUrl = job?.status === "done" ? `${BASE_URL}/download/${job.id}` : null;

  async function theflate() {
    if (!item.serverPath) return;
    try {
      const { job_id } = await uploadFile(
        item.serverPath,
        selectedPreset === "original" ? undefined : selectedPreset,
        undefined,
        selectedFormat !== profile?.output_ext ? selectedFormat : undefined,
        selectedPreset === "original" ? targetMb : undefined,
      );
      setJobId(item.localUrl, job_id);
      toast("Theflating your file...", "info");
    } catch (e) {
      setError(item.localUrl, String(e));
      toast(String(e), "error");
    }
  }

  async function runTranscription() {
    if (!job?.id) return;
    setTranscribing(true);
    try {
      const res = await transcribeFile(job.id);
      setTranscription(res.text);
      toast("Transcription ready", "success");
    } catch (e) {
      toast(`Transcription failed: ${e}`, "error");
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
      toast(`Cloud export failed: ${e}`, "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 12, overflow: "hidden" }}>
      {/* Card Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #18181b", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, color: "#a1a1aa" }}>
          {kindIcon(profile?.kind ?? "")}
          <span style={{ fontWeight: 600, fontSize: 13, color: "#ffffff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.file.name}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {job?.status && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 4,
                background: job.status === "done" ? "#10b98122" : job.status === "failed" ? "#ef444422" : "#18181b",
                color: job.status === "done" ? "#10b981" : job.status === "failed" ? "#ef4444" : "#a1a1aa",
                border: `1px solid ${job.status === "done" ? "#10b98144" : job.status === "failed" ? "#ef444444" : "#27272a"}`,
              }}
            >
              {job.status}
            </span>
          )}
          <button
            onClick={() => removeFile(item.localUrl)}
            aria-label="Remove item"
            style={{ background: "none", border: "none", color: "#71717a", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 2 }}
          >
            ×
          </button>
        </div>
      </div>

      <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Error */}
        {item.error && (
          <div style={{ color: "#ef4444", fontSize: 12, background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", padding: "10px 14px", borderRadius: 8 }}>
            {item.error}
          </div>
        )}

        {/* Upload & Analysis Progress */}
        {!profile && !item.error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#a1a1aa" }}>
              <span>{item.serverPath ? "Inspecting file..." : "Uploading..."}</span>
              {!item.serverPath && <span>{item.uploadPct ?? 0}%</span>}
            </div>
            <div style={{ height: 4, background: "#18181b", borderRadius: 99, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: item.serverPath ? "100%" : `${item.uploadPct ?? 0}%`,
                  background: item.serverPath ? "#10b981" : "#ffffff",
                  borderRadius: 99,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Profile Stats */}
        {profile && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, background: "#121215", border: "1px solid #18181b", borderRadius: 8, padding: "12px 14px" }}>
            {stat("Size", fmt(profile.size_bytes))}
            {stat("Format", profile.codec_name)}
            {profile.duration_secs > 0 ? stat("Duration", fmtTime(Math.round(profile.duration_secs))) : stat("Type", profile.kind)}
            {profile.width ? stat("Dimensions", `${profile.width}×${profile.height}`) : stat("Output", profile.output_ext.toUpperCase())}
          </div>
        )}

        {/* Format Picker */}
        {profile && !job && profile.available_formats?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#a1a1aa", fontWeight: 500 }}>Output Format</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {profile.available_formats.map((fmtExt) => (
                <button
                  key={fmtExt}
                  onClick={() => setOutputFormat(item.localUrl, fmtExt)}
                  style={{
                    padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                    border: `1px solid ${selectedFormat === fmtExt ? "#ffffff" : "#27272a"}`,
                    background: selectedFormat === fmtExt ? "#18181b" : "#09090b",
                    color: selectedFormat === fmtExt ? "#ffffff" : "#71717a",
                  }}
                >
                  {fmtExt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Preset Selector */}
        {profile && !job && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#a1a1aa", fontWeight: 500 }}>Quality Preset</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(item.localUrl, p.id)}
                  style={{
                    padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, textAlign: "left",
                    border: `1px solid ${selectedPreset === p.id ? "#ffffff" : "#27272a"}`,
                    background: selectedPreset === p.id ? "#18181b" : "#09090b",
                    color: selectedPreset === p.id ? "#ffffff" : "#71717a",
                  }}
                >
                  <div>{p.label}</div>
                  <div style={{ fontSize: 10, fontWeight: 400, color: "#71717a", marginTop: 2 }}>{p.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Target Size Slider */}
        {profile && !job && selectedPreset === "original" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#a1a1aa", fontSize: 12 }}>Target file size</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#ffffff" }}>{targetMb.toFixed(1)} MB</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#10b98122", color: "#10b981", border: "1px solid #10b98144" }}>
                  −{savingPct}%
                </span>
              </div>
            </div>
            <input
              type="range" min={minMb} max={originalMb} step={0.1} value={targetMb}
              onChange={(e) => setTargetMb(item.localUrl, Number(e.target.value))}
              style={{ width: "100%", accentColor: "#ffffff", cursor: "pointer" }}
            />
          </div>
        )}

        {/* Estimates */}
        {profile && !job && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, background: "#121215", border: "1px solid #18181b", borderRadius: 8, padding: "10px 14px" }}>
            {stat("Est. Cost", costEstimate, "#10b981")}
            {stat("Theflate Time", fmtTime(profile.estimated_time_secs))}
            {stat("Download Time", fmtTime(downloadTimeSecs))}
          </div>
        )}

        {/* Theflate Button */}
        {profile && !job && (
          <button onClick={theflate} className="vpx-button-primary" style={{ width: "100%", padding: "10px" }}>
            Theflate →
          </button>
        )}

        {/* Processing State */}
        {job && job.status !== "done" && job.status !== "failed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#a1a1aa" }}>
              <span>{job.status === "queued" ? "In queue..." : "Theflating..."}</span>
              <span>
                {job.status === "queued"
                  ? `ETA ${fmtTime(profile?.estimated_time_secs ?? 0)}`
                  : `${job.progress}% · ETA ${fmtTime(job.eta_secs > 0 ? job.eta_secs : profile?.estimated_time_secs ?? 0)}`}
              </span>
            </div>
            <div style={{ height: 6, background: "#18181b", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${job.progress}%`, background: "#ffffff", borderRadius: 99, transition: "width 0.4s ease" }} />
            </div>
          </div>
        )}

        {/* Done State */}
        {job?.status === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, background: "#121215", border: "1px solid #18181b", borderRadius: 8, padding: "12px 14px" }}>
              {stat("Original", fmt(job.original_bytes))}
              {stat("Theflated", fmt(job.compressed_bytes), "#10b981")}
              {stat("Deflation", `${(((job.original_bytes - job.compressed_bytes) / job.original_bytes) * 100).toFixed(1)}%`, "#10b981")}
            </div>

            {/* Media Preview */}
            {outputUrl && profile && (
              <div style={{ borderRadius: 8, overflow: "hidden", background: "#000000", border: "1px solid #27272a" }}>
                {profile.kind === "video" || profile.kind === "image_animated" ? (
                  <video src={outputUrl} controls crossOrigin="anonymous" style={{ width: "100%", maxHeight: 280, display: "block" }} />
                ) : profile.kind?.includes("audio") ? (
                  <audio src={outputUrl} controls crossOrigin="anonymous" style={{ width: "100%", padding: 12 }} />
                ) : (
                  <img src={outputUrl} alt="preview" style={{ width: "100%", maxHeight: 280, objectFit: "contain", display: "block" }} />
                )}
              </div>
            )}

            {/* Transcription */}
            {(profile?.kind === "video" || profile?.kind?.includes("audio")) && (
              <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff" }}>Transcribe</div>
                  <button onClick={runTranscription} disabled={transcribing} className="vpx-button-secondary" style={{ fontSize: 11, padding: "4px 12px" }}>
                    {transcribing ? "Transcribing..." : transcription ? "Redo" : "Generate"}
                  </button>
                </div>
                {transcription && (
                  <div style={{ background: "#000000", border: "1px solid #18181b", borderRadius: 6, padding: 12, fontSize: 12, color: "#a1a1aa", maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                    {transcription}
                  </div>
                )}
              </div>
            )}

            {/* Cloud Export */}
            <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff" }}>Export to Cloud Storage</div>
                  <div style={{ fontSize: 11, color: "#71717a" }}>Send your file to AWS S3, Cloudflare R2, Supabase, Google Drive, or Dropbox</div>
                </div>
                <button onClick={() => setShowExport(!showExport)} className="vpx-button-secondary" style={{ fontSize: 11, padding: "4px 12px" }}>
                  {showExport ? "Hide Target" : "Configure Destination"}
                </button>
              </div>
              {showExport && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {DESTINATIONS.map((dest) => (
                      <button
                        key={dest.id}
                        onClick={() => setExportProvider(dest.id)}
                        style={{
                          padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                          border: `1px solid ${exportProvider === dest.id ? "#ffffff" : "#27272a"}`,
                          background: exportProvider === dest.id ? "#18181b" : "#000000",
                          color: exportProvider === dest.id ? "#ffffff" : "#71717a",
                        }}
                      >
                        {dest.name}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={exportBucket}
                      onChange={(e) => setExportBucket(e.target.value)}
                      placeholder={DESTINATIONS.find((d) => d.id === exportProvider)?.placeholder ?? "target-name"}
                      style={{ flex: 1, padding: "8px 12px", borderRadius: 6, background: "#000000", border: "1px solid #27272a", color: "#ffffff", fontSize: 12, outline: "none" }}
                    />
                    <button onClick={handleDestinationExport} disabled={exporting} className="vpx-button-primary" style={{ fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap" }}>
                      {exporting ? "Exporting..." : "Send File"}
                    </button>
                  </div>
                  {exportedUrl && (
                    <div style={{ fontSize: 11, color: "#10b981", background: "#10b98111", border: "1px solid #10b98133", padding: "8px 12px", borderRadius: 6, wordBreak: "break-all" }}>
                      Successfully exported: <a href={exportedUrl} target="_blank" rel="noreferrer" style={{ color: "#10b981", fontWeight: 700 }}>{exportedUrl}</a>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowQrModal(!showQrModal)} className="vpx-button-secondary" style={{ flex: 1 }}>
                {showQrModal ? "Hide QR Code" : "QR Share"}
              </button>
              {outputUrl && (
                <button
                  onClick={() => downloadFile(job!.id, `theflated_${item.file.name}`)}
                  className="vpx-button-primary"
                  style={{ flex: 1 }}
                >
                  Download
                </button>
              )}
            </div>

            {/* QR Modal */}
            {showQrModal && shareUrl && (
              <div style={{ background: "#121215", border: "1px solid #27272a", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "#a1a1aa" }}>Scan camera to download on mobile device</span>
                <div style={{ background: "#ffffff", padding: 10, borderRadius: 8 }}>
                  <QRCodeSVG value={shareUrl} size={140} />
                </div>
                <span style={{ fontSize: 10, color: "#71717a", wordBreak: "break-all", textAlign: "center" }}>{shareUrl}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
