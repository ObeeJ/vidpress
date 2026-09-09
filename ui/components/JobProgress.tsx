"use client";

import { JobStatus } from "@/lib/store";

interface JobProgressProps {
  status: JobStatus;
  progress: number;
}

export default function JobProgress({ status, progress }: JobProgressProps) {
  const indeterminate = status === "queued";

  return (
    <div
      className={indeterminate ? "track" : undefined}
      style={{
        height: 3,
        borderRadius: 99,
        background: "#18181b",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {!indeterminate && (
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "var(--color-signal, #C9F24E)",
            borderRadius: 99,
            transition: "width var(--dur-2, 0.2s) ease",
          }}
        />
      )}
    </div>
  );
}
