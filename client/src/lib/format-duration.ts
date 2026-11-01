/* format-duration — compact run duration for the multi-agent screens. */

/** 800 → "0.8s", 8200 → "8s", 80000 → "1m 20s", 3600000 → "60m"; null / non-finite → "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m === 0) return `${sec}s`;
  return sec === 0 ? `${m}m` : `${m}m ${sec}s`;
}
