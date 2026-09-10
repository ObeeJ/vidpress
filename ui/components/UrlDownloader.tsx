"use client";

import { useEffect, useRef, useState } from "react";
import { API, downloadFile } from "@/lib/api";
import { toast } from "@/lib/toast";
import Button from "@/components/primitives/Button";

export default function UrlDownloader() {
  const [url, setUrl] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear interval on unmount so it never fires against an unmounted component.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function submit() {
    if (!url.trim()) return;
    // Clear any previous poll before starting a new one.
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
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

      pollRef.current = setInterval(async () => {
        try {
          const jr = await fetch(`${API}/jobs/${data.job_id}`);
          const job = await jr.json();
          setStatus(job.status);
          if (job.status === "done" || job.status === "failed") {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            if (job.status === "done") toast("Ready to download", "success");
            else toast("Download failed", "error");
          }
        } catch {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }, 1500);
    } catch (e: unknown) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ud-card">
      <div>
        <h3 className="ud-title">Download from URL</h3>
        <p className="ud-subtitle">Paste a link from YouTube, Instagram, TikTok, X (Twitter), or Facebook</p>
      </div>

      <div className="ud-input-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://youtu.be/... or https://x.com/..."
          className="ud-input"
        />
        <Button variant="primary" onClick={submit} disabled={loading || !url.trim()}>
          {loading ? "Fetching..." : audioOnly ? "Extract Audio" : "Fetch Media"}
        </Button>
      </div>

      <label className="ud-checkbox-label">
        <input
          type="checkbox"
          checked={audioOnly}
          onChange={(e) => setAudioOnly(e.target.checked)}
          className="ud-checkbox"
        />
        Audio only (MP3)
      </label>

      {status && status !== "done" && status !== "failed" && (
        <div className="ud-status">
          <span className="ud-status-dot" />
          <span><strong className="ud-status-label">{status}</strong>: Downloading...</span>
        </div>
      )}

      {status === "done" && jobId && (
        <div className="ud-result">
          <div className="ud-media-frame">
            {audioOnly ? (
              <audio src={`${API}/download/${jobId}`} controls crossOrigin="anonymous" className="ud-audio" />
            ) : (
              <video src={`${API}/download/${jobId}`} controls playsInline crossOrigin="anonymous" className="ud-video" />
            )}
          </div>
          <Button variant="primary" onClick={() => downloadFile(jobId, audioOnly ? "audio.mp3" : "video.mp4")} className="fc-btn-full">
            Download {audioOnly ? "MP3" : "MP4"}
          </Button>
        </div>
      )}

      {status === "failed" && (
        <div className="fc-error">Download failed. Check the URL and try again.</div>
      )}
    </div>
  );
}
