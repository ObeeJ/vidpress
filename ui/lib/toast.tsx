"use client";
import { useState, useEffect, useCallback } from "react";

// ── Toast system ──────────────────────────────────────────────────────────────
type Toast = { id: number; msg: string; type: "success" | "error" | "info" };
let _toastId = 0;
let _setToasts: ((fn: (t: Toast[]) => Toast[]) => void) | null = null;

export function toast(msg: string, type: Toast["type"] = "info") {
  if (_setToasts) {
    const id = ++_toastId;
    _setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => _setToasts?.((t) => t.filter((x) => x.id !== id)), 4000);
  }
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => { _setToasts = setToasts; return () => { _setToasts = null; }; }, []);
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, zIndex: 9999 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding: "12px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, maxWidth: 360,
          background: t.type === "error" ? "#ef444422" : t.type === "success" ? "#22c55e22" : "#7c3aed22",
          border: `1px solid ${t.type === "error" ? "#ef444466" : t.type === "success" ? "#22c55e66" : "#7c3aed66"}`,
          color: t.type === "error" ? "#fca5a5" : t.type === "success" ? "#86efac" : "#c4b5fd",
          backdropFilter: "blur(8px)",
          animation: "slideIn 0.2s ease",
        }}>
          {t.msg}
        </div>
      ))}
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
