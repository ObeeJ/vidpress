export function bytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  const val = n / Math.pow(1024, i);
  return i === 0 ? `${n} B` : `${val.toFixed(2)} ${units[i]}`;
}

export function duration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Returns a true minus sign (U+2212), not a hyphen. */
export function ratio(before: number, after: number): string {
  if (!before) return "—";
  return `\u2212${Math.round((1 - after / before) * 100)}%`;
}
