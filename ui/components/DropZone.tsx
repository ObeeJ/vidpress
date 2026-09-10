"use client";

import { useCallback, useRef, useState, useId } from "react";
import { useStore } from "@/lib/store";

export default function DropZone() {
  const addFiles = useStore((s) => s.addFiles);
  const setNetworkMbps = useStore((s) => s.setNetworkMbps);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const descId = useId();
  const inputId = useId();

  // Use navigator.connection where available; static default otherwise.
  // The previous implementation fetched google.com/favicon.ico on every mount,
  // leaking user visits to Google, and the timing math was wrong. (Task 3.3)
  const initNetwork = useCallback(() => {
    const nav = navigator as Navigator & { connection?: { downlink?: number } };
    const detected = nav.connection?.downlink;
    if (detected && detected > 0) setNetworkMbps(detected);
  }, [setNetworkMbps]);

  const handle = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
  }, [addFiles]);

  const formats = ["MP4", "MOV", "MKV", "WebM", "MP3", "WAV", "FLAC", "JPG", "PNG", "WebP", "GIF"];

  return (
    <label
      className={`dropzone${dragging ? " dropzone-drag" : ""}`}
      htmlFor={inputId}
      aria-describedby={descId}
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { dragDepth.current--; if (dragDepth.current === 0) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); handle(e.dataTransfer.files); }}
    >
      <div className="dropzone-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div className="dropzone-text">
        <p className={`dropzone-primary${dragging ? " dropzone-primary-drag" : ""}`}>
          {dragging ? "Release to upload" : "Drop video, audio, or image files here"}
        </p>
        <p className="dropzone-secondary">or click to browse local files</p>
      </div>

      <div id={descId} className="dropzone-formats">
        {formats.map((fmt) => (
          <span key={fmt} className="label dropzone-fmt-badge">{fmt}</span>
        ))}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.gif,.webp"
        aria-label="Upload video, audio, or image files"
        aria-describedby={descId}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onChange={(e) => { handle(e.target.files); initNetwork(); }}
      />
    </label>
  );
}
