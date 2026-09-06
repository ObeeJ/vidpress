"use client";
import { useEffect, useRef } from "react";
import { useStore, FileItem } from "@/lib/store";
import { ingestFile, analyzeFile, uploadFile, getJob } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { Tooltip } from "@/app/page";
import { toast } from "@/lib/toast";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

const PRESETS = [
  { id: "original", label: "Original", desc: "Best quality" },
  { id: "web", label: "Web", desc: "Fast load, any browser" },
  { id: "whatsapp", label: "WhatsApp", desc: "Under 16MB" },
  { id: "instagram_reel", label: "Instagram", desc: "9:16 vertical" },
  { id: "twitter", label: "Twitter/X", desc: "Max 2min 20s" },
];

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmtTime(secs: number) {
  if (!secs || secs <= 0) return "instant";
  if (secs < 5) return "a few seconds";
  if (secs < 60) return `~${secs}s`;
  if (secs < 3600) return `~${Math.round(secs / 60)}min`;
  return `~${(secs / 3600).toFixed(1)}hr`;
}

function kindIcon(kind: string) {
  if (kind?.includes("audio")) return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
  );
  if (kind?.includes("image")) return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
  );
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
  );
}

const stat = (label: string, value: string, color?: string) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <span style={{ fontSize: 15, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</span>
    <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
  </div>
);

export default function FileCard({ item }: { item: FileItem }) {
  const { setProfile, setJobId, setJob, setError, removeFile, networkMbps } = useStore();
  const setServerPath = useStore((s) => s.setServerPath);
  const setUploadPct = useStore((s) => s.setUploadPct);
  const setTargetMb = useStore((s) => s.setTargetMb);
  const setPreset = useStore((s) => s.setPreset);
  const setOutputFormat = useStore((s) => s.setOutputFormat);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ingest → analyze on mount
  useEffect(() => {
    if (item.profile || item.error || item.serverPath) return;
    ingestFile(item.file, (pct) => setUploadPct(item.localUrl, pct))
      .then((path) => { setServerPath(item.localUrl, path); return analyzeFile(path); })
      .then((p) => setProfile(item.localUrl, p))
      .catch((e) => { setError(item.localUrl, `Upload failed: ${e}`); toast(`Upload failed: ${e}`, "error"); });
  }, []);

  // Poll job status
  useEffect(() => {
    if (!item.jobId || item.job?.status === "done" || item.job?.status === "failed") return;
    pollRef.current = setInterval(async () => {
      const job = await getJob(item.jobId!);
      setJob(item.localUrl, job);
      if (job.status === "done" || job.status === "failed") {
        clearInterval(pollRef.current!);
        // Browser notification
        if (job.status === "done" && Notification.permission === "granted") {
          new Notification("Compression done!", { body: `${item.file.name} is ready to download`, icon: "/favicon.ico" });
          toast(`${item.file.name} compressed successfully`, "success");
        }
        if (job.status === "failed") toast(`Compression failed for ${item.file.name}`, "error");
      }
    }, 800);
    return () => clearInterval(pollRef.current!);
  }, [item.jobId, item.job?.status]);

  // Request notification permission once
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

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
  const outputUrl = job?.status === "done" ? `/download/${job.id}` : null;
  const shareUrl = job?.status === "done" ? `${BASE_URL}/download/${job.id}` : null;

  const statusColor: Record<string, string> = {
    queued: "#f59e0b", processing: "var(--accent)", done: "var(--green)", failed: "var(--red)"
  };

  async function compress() {
    if (!item.serverPath) return;
    try {
      const { job_id } = await uploadFile(item.serverPath, selectedPreset === "original" ? undefined : selectedPreset, undefined, selectedFormat !== profile?.output_ext ? selectedFormat : undefined);
      setJobId(item.localUrl, job_id);
      toast("Compression started", "info");
    } catch (e) {
      setError(item.localUrl, String(e));
      toast(String(e), "error");
    }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border)", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, color: "var(--muted)" }}>
          {kindIcon(profile?.kind ?? "")}
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.file.name}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {job?.status && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: statusColor[job.status] + "22", color: statusColor[job.status], border: `1px solid ${statusColor[job.status]}44` }}>
              {job.status}
            </span>
          )}
          <button onClick={() => removeFile(item.localUrl)} aria-label="Remove file"
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 2 }}>×</button>
        </div>
      </div>

      <div style={{ padding: "18px", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Error */}
        {item.error && (
          <p role="alert" style={{ color: "var(--red)", fontSize: 12, background: "#ef444411", padding: "10px 14px", borderRadius: 10 }}>
            {item.error}
          </p>
        )}

        {/* Upload progress */}
        {!profile && !item.error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
              <span>{item.serverPath ? "Analyzing…" : "Uploading to server…"}</span>
              {!item.serverPath && <span>{item.uploadPct ?? 0}%</span>}
            </div>
            <div style={{ height: 4, background: "var(--surface2)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: item.serverPath ? "100%" : `${item.uploadPct ?? 0}%`, background: item.serverPath ? "var(--green)" : "var(--accent)", borderRadius: 99, transition: "width 0.3s ease" }} />
            </div>
          </div>
        )}

        {/* Profile stats */}
        {profile && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, background: "var(--surface2)", borderRadius: 12, padding: "14px 16px" }}>
            {stat("Original size", fmt(profile.size_bytes))}
            {stat("Codec", profile.codec_name)}
            {profile.duration_secs > 0 ? stat("Duration", fmtTime(Math.round(profile.duration_secs))) : stat("Type", profile.kind)}
            {profile.width ? stat("Dimensions", `${profile.width}×${profile.height}`) : <div />}
          </div>
        )}

        {/* Output format picker */}
        {profile && !job && profile.available_formats?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Output format
              <Tooltip text="The file type you'll get back. MP4 works everywhere. Leave it on default if you're unsure." />
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {profile.available_formats.map((fmt) => (
                <button key={fmt} onClick={() => setOutputFormat(item.localUrl, fmt)}
                  style={{
                    padding: "5px 14px", borderRadius: 8, cursor: "pointer",
                    fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px",
                    border: `1px solid ${selectedFormat === fmt ? "var(--accent)" : "var(--border)"}`,
                    background: selectedFormat === fmt ? "var(--accent)22" : "var(--surface2)",
                    color: selectedFormat === fmt ? "var(--accent)" : "var(--muted)",
                    transition: "all 0.15s",
                  }}>
                  {fmt}
                  {fmt === profile.output_ext && (
                    <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.6 }}>default</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Preset selector */}
        {profile && !job && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Output preset
              <Tooltip text="A ready-made setting for a specific platform. Pick WhatsApp if you're sending via WhatsApp, Instagram for Reels, Web for websites. Leave on Original if unsure." />
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setPreset(item.localUrl, p.id)}
                  style={{ padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, border: `1px solid ${selectedPreset === p.id ? "var(--accent)" : "var(--border)"}`, background: selectedPreset === p.id ? "var(--accent)22" : "var(--surface2)", color: selectedPreset === p.id ? "var(--accent)" : "var(--muted)", transition: "all 0.15s" }}>
                  {p.label}
                  <span style={{ display: "block", fontSize: 10, fontWeight: 400, marginTop: 1 }}>{p.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Target size slider */}
        {profile && !job && selectedPreset === "original" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>Target size
                <Tooltip text="Drag left to make the file smaller (slightly lower quality). Drag right to keep it closer to the original. The minimum is 1% of the original size." />
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{targetMb.toFixed(1)} MB</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: savingPct > 0 ? "#22c55e22" : "var(--surface2)", color: savingPct > 0 ? "var(--green)" : "var(--muted)" }}>−{savingPct}%</span>
              </div>
            </div>
            <input type="range" min={minMb} max={originalMb} step={0.1} value={targetMb}
              onChange={(e) => setTargetMb(item.localUrl, Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
              <span>Min {minMb.toFixed(1)} MB (1%)</span>
              <span>{originalMb.toFixed(1)} MB (original)</span>
            </div>
          </div>
        )}

        {/* Estimates */}
        {profile && !job && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, background: "var(--surface2)", borderRadius: 12, padding: "14px 16px" }}>
              {stat("Est. cost", costEstimate, "var(--accent)")}
              {stat("Time to compress", fmtTime(profile.estimated_time_secs))}
              {stat("Time to download", fmtTime(downloadTimeSecs))}
          </div>
        )}

        {/* Compress */}
        {profile && !job && (
          <button onClick={compress}
            style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--accent)")}>
            Compress →
          </button>
        )}

        {/* Compression progress */}
        {job && job.status !== "done" && job.status !== "failed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
              <span>Compressing…</span>
              <span>{job.progress}% · ETA {fmtTime(job.eta_secs)}</span>
            </div>
            <div style={{ height: 6, background: "var(--surface2)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${job.progress}%`, background: "var(--accent)", borderRadius: 99, transition: "width 0.4s ease" }} />
            </div>
          </div>
        )}

        {/* Done */}
        {job?.status === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, background: "var(--surface2)", borderRadius: 12, padding: "14px 16px" }}>
              {stat("Before", fmt(job.original_bytes))}
              {stat("After", fmt(job.compressed_bytes), "var(--green)")}
              {stat("Saved", `${(((job.original_bytes - job.compressed_bytes) / job.original_bytes) * 100).toFixed(1)}%`, "var(--green)")}
            </div>

            {shareUrl && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <p style={{ fontSize: 12, color: "var(--muted)" }}>Scan to download on any device</p>
                <div style={{ background: "#fff", padding: 10, borderRadius: 12 }}>
                  <QRCodeSVG value={shareUrl} size={120} />
                </div>
                <p style={{ fontSize: 10, color: "var(--muted)", wordBreak: "break-all", textAlign: "center" }}>{shareUrl}</p>
              </div>
            )}

            {/* Preview */}
            {outputUrl && profile && (
              <div style={{ borderRadius: 12, overflow: "hidden", background: "var(--surface2)" }}>
                {profile.kind === "video" || profile.kind === "image_animated" ? (
                  <video src={outputUrl} controls style={{ width: "100%", maxHeight: 240, display: "block" }} />
                ) : profile.kind?.includes("audio") ? (
                  <audio src={outputUrl} controls style={{ width: "100%", padding: "12px" }} />
                ) : profile.kind?.includes("image") ? (
                  <img src={outputUrl} alt="preview" style={{ width: "100%", maxHeight: 240, objectFit: "contain", display: "block" }} />
                ) : null}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => navigator.share?.({ title: item.file.name, url: shareUrl ?? "" }).catch(() => {})}
                style={{ flex: 1, padding: "11px", borderRadius: 12, border: "1px solid var(--border)", background: "none", color: "var(--text)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                Share
              </button>
              {outputUrl && (
                <a href={outputUrl} download style={{ flex: 1, textDecoration: "none" }}>
                  <button style={{ width: "100%", padding: "11px", borderRadius: 12, border: "none", background: "var(--green)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Download
                  </button>
                </a>
              )}
            </div>
          </div>
        )}

        {job?.status === "failed" && (
          <p role="alert" style={{ color: "var(--red)", fontSize: 12, background: "#ef444411", padding: "10px 14px", borderRadius: 10 }}>
            Compression failed. The file may be corrupted or an unsupported format.
          </p>
        )}
      </div>
    </div>
  );
}
