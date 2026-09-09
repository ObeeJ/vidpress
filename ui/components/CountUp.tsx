"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  from: number;
  to: number;
  format: (n: number) => string;
  durationMs?: number;
}

export default function CountUp({ from, to, format, durationMs = 560 }: CountUpProps) {
  const [value, setValue] = useState(from);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setValue(to); return; }

    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // expo-out: 1 - (1-t)^3
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [from, to, durationMs]);

  return <span className="tabular">{format(value)}</span>;
}
