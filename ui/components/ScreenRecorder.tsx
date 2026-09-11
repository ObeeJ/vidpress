"use client";

import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { ingestFile, analyzeFile } from "@/lib/api";
import { toast, toastError } from "@/lib/toast";
import Button from "@/components/primitives/Button";

type RecordState = "idle" | "recording" | "processing";

export default function ScreenRecorder() {
  const { addFileWithUrl, setIngestId, setProfile, setError } = useStore();
  const [state, setState] = useState<RecordState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks that are not part of the recorded stream and so would otherwise
  // never be stopped - chiefly the microphone, which keeps the browser's
  // recording indicator lit until it is released.
  const extraTracksRef = useRef<MediaStreamTrack[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  async function startRecording() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      // Mix whatever audio sources actually exist.
      //
      // createMediaStreamSource throws on a stream with no audio track, and
      // display capture very often has none - Chrome only grants system audio
      // if the user ticks "Share audio", and Firefox and Safari mostly cannot
      // provide it at all. The previous version connected the display source
      // unconditionally inside a try/catch, so that throw skipped the mic
      // connection too and the fallback recorded no audio whatsoever, even
      // when the microphone was working perfectly. Each source is now checked
      // before it is connected.
      let stream = display;
      try {
        const mic = await navigator.mediaDevices
          .getUserMedia({ audio: true })
          .catch(() => null);
        const displayHasAudio = display.getAudioTracks().length > 0;

        if (mic || displayHasAudio) {
          const ctx = new AudioContext();
          // An AudioContext can start suspended under autoplay policies, in
          // which case no samples flow and the recording comes out silent.
          if (ctx.state === "suspended") await ctx.resume();

          const dest = ctx.createMediaStreamDestination();
          if (displayHasAudio) ctx.createMediaStreamSource(display).connect(dest);
          if (mic) ctx.createMediaStreamSource(mic).connect(dest);

          stream = new MediaStream([
            ...display.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ]);

          // Kept so stopRecording can release them. Mic tracks are not part of
          // `stream`, so stopping `stream` alone leaves the microphone live and
          // the browser's recording indicator lit after the user has stopped.
          extraTracksRef.current = [
            ...(mic ? mic.getTracks() : []),
            ...display.getAudioTracks(),
          ];
          audioCtxRef.current = ctx;
        }
      } catch (e) {
        // Genuinely unexpected - fall back to video only rather than failing
        // the recording, but do not pretend this is the ordinary
        // no-microphone case the way the previous comment did.
        console.warn("audio mixing failed, recording video only", e);
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
      toastError(e, "Screen capture was denied or unavailable. Check browser permissions.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stop();
    setState("processing");
  }

  async function finalise(stream: MediaStream) {
    stream.getTracks().forEach((t) => t.stop());
    // Release the sources that never reached the recorded stream. Without this
    // the microphone stays open and the browser keeps showing a recording
    // indicator long after the user has stopped.
    extraTracksRef.current.forEach((t) => t.stop());
    extraTracksRef.current = [];
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
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
      setError(localUrl, "Recording upload failed. Check your connection and try again.");
      toastError(e, "Recording upload failed. Check your connection and try again.");
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
