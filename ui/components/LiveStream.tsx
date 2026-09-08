"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8081";

type StreamState = "idle" | "connecting" | "live" | "done";

export default function LiveStream() {
  const { setJob, setJobId } = useStore();
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [jobId, setJobIdLocal] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startStream() {
    setStreamState("connecting");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        const mr = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
            ? "video/webm;codecs=vp9,opus"
            : "video/webm",
        });
        mr.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then((buf) => ws.send(buf));
          }
        };
        mr.start(500); // 500ms chunks for low latency
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
            toast(`Live stream job: ${msg.job_id.slice(0, 8)}…`, "info");
          }
        } catch {}
      };

      ws.onerror = () => {
        toast("WebSocket connection failed", "error");
        setStreamState("idle");
        stream.getTracks().forEach((t) => t.stop());
      };

      ws.onclose = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        stream.getTracks().forEach((t) => t.stop());
      };
    } catch (e) {
      toast(`Stream failed: ${e}`, "error");
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

  const previewUrl = jobId
    ? `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"}/preview/${jobId}`
    : null;

  return (
    <div style={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 12, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#ffffff" }}>Live Stream</span>
          <span style={{ fontSize: 12, color: "#71717a" }}>Record your screen and compress in real-time</span>
        </div>
        {streamState === "live" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", fontVariantNumeric: "tabular-nums" }}>LIVE {fmt(elapsed)}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {streamState === "idle" && (
          <button onClick={startStream} className="vpx-button-primary" style={{ flex: 1 }}>
            Go Live
          </button>
        )}
        {streamState === "connecting" && (
          <div style={{ flex: 1, padding: "10px", textAlign: "center", fontSize: 13, color: "#a1a1aa" }}>Connecting...</div>
        )}
        {streamState === "live" && (
          <button onClick={stopStream} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #ef4444", background: "#ef444422", color: "#ef4444", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            End Stream
          </button>
        )}
        {streamState === "done" && jobId && (
          <div style={{ flex: 1, fontSize: 12, color: "#10b981" }}>
            Recording saved — ready to download
          </div>
        )}
      </div>

      {/* Live preview of the stream output as it's being written */}
      {previewUrl && streamState === "live" && (
        <div style={{ borderRadius: 8, overflow: "hidden", background: "#000", border: "1px solid #27272a" }}>
          <video
            key={previewUrl}
            src={previewUrl}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", maxHeight: 240, display: "block" }}
          />
        </div>
      )}

      <div style={{ fontSize: 11, color: "#52525b" }}>
        Your recording will be available to download when you end the session.
      </div>
    </div>
  );
}
