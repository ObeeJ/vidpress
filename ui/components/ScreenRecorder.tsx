"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { ingestFile, analyzeFile } from "@/lib/api";
import { toast } from "@/lib/toast";
import Button from "@/components/primitives/Button";

type RecordState = "idle" | "recording" | "processing";

export default function ScreenRecorder() {
  const { addFileWithUrl, setIngestId, setProfile, setError } = useStore();
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
    const localUrl = URL.createObjectURL(file);
    addFileWithUrl(file, localUrl);
    try {
      const ingestId = await ingestFile(file);
      setIngestId(localUrl, ingestId);
      const profile = await analyzeFile(ingestId);
      setProfile(localUrl, profile);
      toast("Screen recording ready to theflate", "success");
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
    <div className="ud-card">
      <div className="ud-card-header">
        <span className="ud-title">Screen Recorder</span>
        <span className="ud-subtitle">Capture your screen and compress it</span>
        {state === "recording" && (
          <div className="ud-live-badge">
            <span className="ud-rec-dot" />
            <span className="ud-live-timer">{fmt(elapsed)}</span>
          </div>
        )}
      </div>

      <div className="ud-input-row">
        {state === "idle" && (
          <Button variant="primary" onClick={startRecording} className="fc-btn-full">Start Recording</Button>
        )}
        {state === "recording" && (
          <button onClick={stopRecording} className="ud-stop-btn">Stop &amp; Theflate</button>
        )}
        {state === "processing" && (
          <div className="ud-processing">Processing...</div>
        )}
      </div>

      <div className="ud-hint">
        Browser will prompt you to choose a screen, window, or tab. Microphone audio is included if permitted.
      </div>
    </div>
  );
}
