/** Format bytes using binary units with two decimal places. */
export function bytes(n: number): string {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log2(n) / 10);
  const idx = Math.min(i, units.length - 1);
  return `${(n / Math.pow(1024, idx)).toFixed(2)} ${units[idx]}`;
}

/** Format a compression ratio as a true-minus percentage. Returns em-dash for zero input. */
export function ratio(before: number, after: number): string {
  if (before === 0) return "\u2014";
  const pct = Math.round((1 - after / before) * 100);
  return `\u2212${pct}%`;
}

/** Format seconds as m:ss. */
export function duration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
