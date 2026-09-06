"use client";
import { useState } from "react";
import { toast } from "@/lib/toast";

const API = "http://localhost:8080";

export default function UrlDownloader() {
  const [url, setUrl] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!url.trim()) return;
    setLoading(true); setJobId(null); setStatus(null);
    try {
      const r = await fetch(`${API}/download-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, audio_only: audioOnly }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setJobId(data.job_id); setStatus("queued");
      toast("Download started", "info");
      const poll = setInterval(async () => {
        const jr = await fetch(`${API}/jobs/${data.job_id}`);
        const job = await jr.json();
        setStatus(job.status);
        if (job.status === "done") { clearInterval(poll); toast("Ready to play!", "success"); }
        if (job.status === "failed") { clearInterval(poll); toast("Download failed", "error"); }
      }, 1500);
    } catch (e: unknown) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Download from a link</p>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>YouTube · Instagram · TikTok · X (Twitter) · Facebook</p>
      </div>

      <input value={url} onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="https://youtu.be/..."
        style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }} />

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)}
          style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
        Audio only (MP3) — extract just the sound
      </label>

      {/* Progress */}
      {status && status !== "done" && status !== "failed" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--accent)" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s infinite" }} />
          {status}…
        </div>
      )}

      {/* Preview + download when done */}
      {status === "done" && jobId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ borderRadius: 12, overflow: "hidden", background: "#000" }}>
            {audioOnly
              ? <audio src={`/download/${jobId}`} controls style={{ width: "100%", padding: "12px", display: "block" }} />
              : <video src={`/download/${jobId}`} controls playsInline style={{ width: "100%", maxHeight: 300, display: "block" }} />
            }
          </div>
          <a href={`/download/${jobId}`} download
            style={{ display: "block", padding: "11px", borderRadius: 10, background: "var(--green)", color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none", textAlign: "center" }}>
            Download {audioOnly ? "MP3" : "MP4"}
          </a>
        </div>
      )}

      {status === "failed" && (
        <p style={{ fontSize: 12, color: "var(--red)", background: "#ef444411", padding: "8px 12px", borderRadius: 8 }}>
          Download failed. Check the URL and try again.
        </p>
      )}

      <button onClick={submit} disabled={loading || !url.trim()}
        style={{ padding: "11px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: loading || !url.trim() ? 0.6 : 1 }}>
        {loading ? "Starting…" : audioOnly ? "Extract audio" : "Download video"}
      </button>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}
