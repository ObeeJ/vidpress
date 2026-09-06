"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

export default function DropZone() {
  const addFiles = useStore((s) => s.addFiles);
  const setNetworkMbps = useStore((s) => s.setNetworkMbps);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handle = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
  }, [addFiles]);

  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { downlink?: number } };
    const detected = nav.connection?.downlink;
    if (detected && detected > 0) {
      setNetworkMbps(detected);
    } else {
      const start = Date.now();
      fetch("https://www.google.com/favicon.ico", { cache: "no-store", mode: "no-cors" })
        .then(() => {
          const ms = Date.now() - start;
          const mbps = Math.round((1 / 1024 / (ms / 1000)) * 8 * 100) / 100;
          if (mbps > 0 && mbps < 10000) setNetworkMbps(Math.min(mbps, 1000));
        })
        .catch(() => {});
    }
  }, []);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      style={{
        border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 16,
        padding: dragging ? "60px 24px" : "48px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        background: dragging ? "var(--accent)0d" : "var(--surface)",
        transition: "all 0.15s ease",
        transform: dragging ? "scale(1.01)" : "scale(1)",
      }}
    >
      <div style={{
        width: 52, height: 52, borderRadius: 14,
        background: dragging ? "var(--accent)33" : "var(--surface2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: dragging ? 28 : 24,
        transition: "all 0.15s ease",
      }}>
        {dragging ? "⬇️" : "📁"}
      </div>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontWeight: 600, marginBottom: 4, color: dragging ? "var(--accent)" : "var(--text)" }}>
          {dragging ? "Drop it!" : "Drop files here"}
        </p>
        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          {dragging ? "Release to add your file" : "or click to browse · Video · Audio · Images · GIF"}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.gif,.webp"
        style={{ display: "none" }}
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}
