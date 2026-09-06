"use client";
import { useState } from "react";
import { toast } from "@/lib/toast";

const API = "http://localhost:8080";

export default function UrlDownloader() {
  const [url, setUrl] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!url.trim()) return;
    setLoading(true); setError(null); setJobId(null); setStatus(null);
    try {
      const r = await fetch(`${API}/download-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, audio_only: audioOnly }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      const { job_id } = await r.json();
      setJobId(job_id); setStatus("queued");
      toast("Download started", "info");
      const poll = setInterval(async () => {
        const jr = await fetch(`${API}/jobs/${job_id}`);
        const job = await jr.json();
        setStatus(job.status);
        if (job.status === "done") { clearInterval(poll); toast("Download ready!", "success"); }
        if (job.status === "failed") { clearInterval(poll); toast("Download failed", "error"); }
      }, 1500);
    } catch (e: unknown) {
      setError(String(e));
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  const PLATFORMS = ["YouTube", "Instagram", "TikTok", "X (Twitter)", "Facebook"];

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Download from a link</p>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          Paste a link from {PLATFORMS.join(", ")}
        </p>
      </div>

      <input
        value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="https://youtube.com/watch?v=..."
        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)}
            style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
          Audio only (MP3)
        </label>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>— extract just the sound</span>
      </div>

      {error && <p style={{ fontSize: 12, color: "var(--red)", background: "#ef444411", padding: "8px 12px", borderRadius: 8 }}>{error}</p>}

      {status && (
        <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: status === "done" ? "var(--green)" : status === "failed" ? "var(--red)" : "var(--accent)" }}>
            {status === "done" ? "Done!" : status === "failed" ? "Failed" : `${status}…`}
          </span>
          {status === "done" && jobId && (
            <a href={`/download/${jobId}`} download
              style={{ padding: "6px 14px", borderRadius: 8, background: "var(--green)", color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
              Download
            </a>
          )}
        </div>
      )}

      <button onClick={submit} disabled={loading || !url.trim()}
        style={{ padding: "11px", borderRadius: 12, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: loading || !url.trim() ? 0.6 : 1 }}>
        {loading ? "Starting…" : audioOnly ? "Extract audio" : "Download video"}
      </button>

      <p style={{ fontSize: 11, color: "var(--muted)" }}>
        Requires Premium API key · <a href="/pricing" style={{ color: "var(--accent)" }}>Get one free</a>
      </p>
    </div>
  );
}
