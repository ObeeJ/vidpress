"use client";
import { useState, useEffect, useCallback } from "react";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; msg: string; type: ToastType };

let _id = 0;
let _set: ((fn: (t: Toast[]) => Toast[]) => void) | null = null;

export function toast(msg: string, type: ToastType = "info") {
  if (!_set) return;
  const id = ++_id;
  _set((t) => [...t, { id, msg, type }]);
  setTimeout(() => _set?.((t) => t.filter((x) => x.id !== id)), 5000);
}

/** Maps a raw caught error to a user-friendly message, then toasts it. */
export function toastError(e: unknown, fallback = "Something went wrong. Please try again.") {
  const raw = e instanceof Error ? e.message : String(e);
  // Strip "Error: " prefix that JS adds
  const clean = raw.replace(/^Error:\s*/i, "").trim();

  // Map known server/network patterns to friendly copy
  const msg =
    /rate.?limit/i.test(clean)         ? "You're going too fast — slow down a bit and retry." :
    /unauthorized|401/i.test(clean)    ? "Your API key isn't valid. Check it in settings." :
    /forbidden|403/i.test(clean)       ? "You don't have permission to do that." :
    /not.?found|404/i.test(clean)      ? "That file or job no longer exists." :
    /too.?large|413/i.test(clean)      ? "File is too large to upload. Try a smaller file." :
    /unsupported|415/i.test(clean)     ? "That file format isn't supported yet." :
    /timeout|timed.?out/i.test(clean)  ? "The request timed out. Check your connection and retry." :
    /network|fetch|failed to fetch/i.test(clean) ? "Can't reach the server. Check your connection." :
    /websocket/i.test(clean)           ? "Live connection dropped. Refresh and try again." :
    /disk|storage|no space/i.test(clean) ? "Server is out of storage space. Try again later." :
    /ffmpeg|codec/i.test(clean)        ? "Media processing failed. Try a different format." :
    /transcri/i.test(clean)            ? "Transcription failed. The audio may be too short or unclear." :
    clean.length > 0 && clean.length < 120 ? clean : fallback;

  toast(msg, "error");
}

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error:   "✕",
  info:    "·",
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => { _set = setToasts; return () => { _set = null; }; }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} role="alert" aria-live="assertive">
          <span className="toast-icon" aria-hidden="true">{ICONS[t.type]}</span>
          <span className="toast-msg">{t.msg}</span>
          <button
            className="toast-dismiss"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
