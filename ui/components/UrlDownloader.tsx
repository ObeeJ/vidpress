"use client";

import { useState } from "react";
import { API } from "@/lib/api";
import { toast } from "@/lib/toast";

export default function UrlDownloader() {
  const [url, setUrl] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!url.trim()) return;
    setLoading(true);
    setJobId(null);
    setStatus(null);
    try {
      const r = await fetch(`${API}/download-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, audio_only: audioOnly }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setJobId(data.job_id);
      setStatus("queued");
      toast("Download started", "info");

      const poll = setInterval(async () => {
        const jr = await fetch(`${API}/jobs/${data.job_id}`);
        const job = await jr.json();
        setStatus(job.status);
        if (job.status === "done") {
          clearInterval(poll);
          toast("Media download ready!", "success");
        }
        if (job.status === "failed") {
          clearInterval(poll);
          toast("Media extraction failed", "error");
        }
      }, 1500);
    } catch (e: unknown) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#ffffff" }}>Download from URL</h3>
          <p style={{ fontSize: 12, color: "#a1a1aa" }}>Paste a link from YouTube, Instagram, TikTok, X (Twitter), or Facebook</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://x.com/user/status/... or https://youtu.be/..."
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 9999,
            border: "1px solid #27272a",
            background: "#000000",
            color: "#ffffff",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          onClick={submit}
          disabled={loading || !url.trim()}
          className="vpx-button-primary"
          style={{ opacity: loading || !url.trim() ? 0.5 : 1, padding: "8px 18px", whiteSpace: "nowrap" }}
        >
          {loading ? "Extracting..." : audioOnly ? "Extract Audio" : "Fetch Media"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#a1a1aa", cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={audioOnly}
            onChange={(e) => setAudioOnly(e.target.checked)}
            style={{ accentColor: "#ffffff", width: 15, height: 15, borderRadius: 4 }}
          />
        <span style={{ fontSize: 11, color: "#71717a" }}>Audio only (MP3)</span>
      </div>

      {/* Progress state */}
      {status && status !== "done" && status !== "failed" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: "#121215", border: "1px solid #27272a", fontSize: 13, color: "#f4f4f5" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", animation: "vpx-pulse 1s infinite" }} />
          <span>Status: <strong style={{ color: "#ffffff", textTransform: "capitalize" }}>{status}</strong> — Downloading...</span>
        </div>
      )}

      {/* Preview & Download */}
      {status === "done" && jobId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid #18181b", paddingTop: 14 }}>
          <div style={{ borderRadius: 8, overflow: "hidden", background: "#000000", border: "1px solid #27272a" }}>
            {audioOnly ? (
              <audio src={`/download/${jobId}`} controls style={{ width: "100%", padding: 12, display: "block" }} />
            ) : (
              <video src={`/download/${jobId}`} controls playsInline style={{ width: "100%", maxHeight: 320, display: "block" }} />
            )}
          </div>
          <a
            href={`/download/${jobId}`}
            download
            className="vpx-button-primary"
            style={{ textAlign: "center", textDecoration: "none", width: "100%" }}
          >
            Download {audioOnly ? "MP3 Audio" : "MP4 Video"}
          </a>
        </div>
      )}

      {status === "failed" && (
        <div style={{ fontSize: 12, color: "#ef4444", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", padding: "10px 14px", borderRadius: 8 }}>
          Extraction failed. Please check the URL syntax or access permissions and try again.
        </div>
      )}
    </div>
  );
}
