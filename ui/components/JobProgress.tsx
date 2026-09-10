"use client";

import { JobStatus } from "@/lib/store";

interface JobProgressProps {
  status: JobStatus;
  progress: number;
}

export default function JobProgress({ status, progress }: JobProgressProps) {
  // "queued" is always indeterminate regardless of a stale/leftover progress
  // value - a job that hasn't started has nothing meaningful to show a
  // percentage for. Only "processing" additionally requires progress === 0.
  // (Parenthesizing this as `(queued || processing) && progress === 0`
  // looks like a harmless clarity fix but silently changes the behavior:
  // a requeued job carrying a nonzero progress from its previous attempt
  // would render a stale determinate bar instead of the indeterminate one.)
  const indeterminate = status === "queued" || (status === "processing" && progress === 0);

  if (indeterminate) {
    return <div className="track" style={{ height: 4, borderRadius: "var(--radius-full)" }} />;
  }

  return (
    <div style={{
      height: 4,
      borderRadius: "var(--radius-full)",
      background: "var(--color-surface-2)",
      overflow: "hidden",
    }}>
      <div style={{
        height: "100%",
        width: `${progress}%`,
        background: "var(--color-signal)",
        borderRadius: "var(--radius-full)",
        transition: `width var(--dur-2) var(--ease-out)`,
      }} />
    </div>
  );
}
