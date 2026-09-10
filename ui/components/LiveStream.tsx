"use client";

import { useRef, useState } from "react";
import { downloadFile } from "@/lib/api";
import { toast, toastError } from "@/lib/toast";
import Button from "@/components/primitives/Button";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8081";

type StreamState = "idle" | "connecting" | "live" | "done";

export default function LiveStream() {
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [jobId, setJobIdLocal] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startStream() {
    setStreamState("connecting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const mr = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm",
        });
        mr.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then((buf) => ws.send(buf));
          }
        };
        mr.start(500);
        mrRef.current = mr;
        setStreamState("live");
        setElapsed(0);
        timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
        stream.getVideoTracks()[0].onended = () => stopStream();
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.job_id) {
            setJobIdLocal(msg.job_id);
            toast("Stream captured. Download when you end the session", "info");
          }
        } catch {}
      };

      ws.onerror = () => {
        toast("Live connection dropped. Refresh and try again.", "error");
        setStreamState("idle");
        stream.getTracks().forEach((t) => t.stop());
      };

      ws.onclose = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        stream.getTracks().forEach((t) => t.stop());
      };
    } catch (e) {
      toastError(e, "Screen capture was denied or unavailable. Check browser permissions.");
      setStreamState("idle");
    }
  }

  function stopStream() {
    if (timerRef.current) clearInterval(timerRef.current);
    mrRef.current?.stop();
    wsRef.current?.close();
    setStreamState("done");
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  return (
    <div className="ud-card">
      <div className="ud-card-header">
        <span className="ud-title">Live Stream</span>
        <span className="ud-subtitle">Record your screen and compress in real-time</span>
        {streamState === "live" && (
          <div className="ud-live-badge">
            <span className="ud-rec-dot" />
            <span className="ud-live-timer">LIVE {fmt(elapsed)}</span>
          </div>
        )}
      </div>

      <div className="ud-input-row">
        {streamState === "idle" && (
          <Button variant="primary" onClick={startStream} className="fc-btn-full">Go Live</Button>
        )}
        {streamState === "connecting" && (
          <div className="ud-processing">Connecting...</div>
        )}
        {streamState === "live" && (
          <button onClick={stopStream} className="ud-stop-btn">End Stream</button>
        )}
        {streamState === "done" && jobId && (
          <Button variant="primary" onClick={() => downloadFile(jobId, "stream.webm")} className="fc-btn-full">
            Download Recording
          </Button>
        )}
        {streamState === "done" && !jobId && (
          <div className="ud-hint">No recording captured.</div>
        )}
      </div>

      <div className="ud-hint">
        Your recording will be available to download when you end the session.
      </div>
    </div>
  );
}
