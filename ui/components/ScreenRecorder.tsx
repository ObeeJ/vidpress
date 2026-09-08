"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { ingestFile, analyzeFile } from "@/lib/api";
import { toast } from "@/lib/toast";

type RecordState = "idle" | "recording" | "processing";

export default function ScreenRecorder() {
  const { addFiles, setServerPath, setProfile, setError } = useStore();
  const [state, setState] = useState<RecordState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startRecording() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      // Try to also capture mic audio and mix it in
      let stream = display;
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(display).connect(dest);
        ctx.createMediaStreamSource(mic).connect(dest);
        const mixed = new MediaStream([
          ...display.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ]);
        stream = mixed;
      } catch {
        // mic unavailable — screen audio only
      }

      chunksRef.current = [];
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm",
      });
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => finalise(stream);
      mr.start(1000); // 1s chunks
      mediaRef.current = mr;

      // Stop recording if user ends screen share from browser UI
      display.getVideoTracks()[0].onended = () => stopRecording();

      setState("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e) {
      toast(`Screen capture failed: ${e}`, "error");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stop();
    setState("processing");
  }

  async function finalise(stream: MediaStream) {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    const file = new File([blob], `screen_${Date.now()}.webm`, { type: "video/webm" });

    // Add to the store so a FileCard appears
    addFiles([file]);
    const localUrl = URL.createObjectURL(file);

    try {
      const path = await ingestFile(file);
      setServerPath(localUrl, path);
      const profile = await analyzeFile(path);
      setProfile(localUrl, profile);
      toast("Screen recording ready to compress", "success");
    } catch (e) {
      setError(localUrl, String(e));
      toast(String(e), "error");
    } finally {
      setState("idle");
    }
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
          <span style={{ fontSize: 14, fontWeight: 700, color: "#ffffff" }}>Screen Recorder</span>
          <span style={{ fontSize: 12, color: "#71717a" }}>Capture your screen and compress it</span>
        </div>
        {state === "recording" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", fontVariantNumeric: "tabular-nums" }}>{fmt(elapsed)}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {state === "idle" && (
          <button onClick={startRecording} className="vpx-button-primary" style={{ flex: 1 }}>
            Start Recording
          </button>
        )}
        {state === "recording" && (
          <button onClick={stopRecording} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #ef4444", background: "#ef444422", color: "#ef4444", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Stop & Compress
          </button>
        )}
        {state === "processing" && (
          <div style={{ flex: 1, padding: "10px", textAlign: "center", fontSize: 13, color: "#a1a1aa" }}>
            Processing...
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#52525b" }}>
        Browser will prompt you to choose a screen, window, or tab. Microphone audio is included if permitted.
      </div>
    </div>
  );
}
