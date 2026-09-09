"use client";

import { useEffect, useRef } from "react";

interface CountUpProps {
  from: number;
  to: number;
  format: (n: number) => string;
  durationMs?: number;
}

export default function CountUp({ from, to, format, durationMs = 560 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || from === to) {
      if (ref.current) ref.current.textContent = format(to);
      return;
    }

    const start = performance.now();
    let raf: number;

    function tick(now: number) {
      const t = Math.min((now - start) / durationMs, 1);
      // expo-out: 1 - (1-t)^3
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (to - from) * eased);
      if (ref.current) ref.current.textContent = format(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, format, durationMs]);

  return <span ref={ref}>{format(to)}</span>;
}
