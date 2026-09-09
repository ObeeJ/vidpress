"use client";

import { useRef, useState } from "react";
import { downloadFile } from "@/lib/api";
import { toast } from "@/lib/toast";
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
            toast("Stream captured: ready to download when ended", "info");
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
          <Button variant="primary" onClick={startStream} style={{ flex: 1 }}>Go Live</Button>
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
          <Button variant="primary" onClick={() => downloadFile(jobId, "stream.webm")} style={{ flex: 1 }}>
            Download Recording
          </Button>
        )}
        {streamState === "done" && !jobId && (
          <div style={{ flex: 1, fontSize: 12, color: "#71717a", padding: "10px" }}>No recording captured.</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#52525b" }}>
        Your recording will be available to download when you end the session.
      </div>
    </div>
  );
}
