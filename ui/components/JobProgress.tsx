"use client";

import { JobStatus } from "@/lib/store";

interface JobProgressProps {
  status: JobStatus;
  progress: number;
}

export default function JobProgress({ status, progress }: JobProgressProps) {
  const indeterminate = status === "queued" || status === "processing" && progress === 0;

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
