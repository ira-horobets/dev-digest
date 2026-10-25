/** eval-format.ts — shared formatters for the Eval Pipeline surfaces (the
 *  agent editor's Evals tab, the /eval dashboard and the agent detail page).
 *  A null ratio means "not applicable", never a fake 0 — callers pass their
 *  own translated "n/a" label so this module holds no English. */

/** 0..1 ratio → whole-percent string ("82%"), or `naLabel`. */
export function formatPct(value: number | null | undefined, naLabel: string): string {
  return value == null ? naLabel : `${Math.round(value * 100)}%`;
}

/** 0..1 ratio → 0..100 number for bars (null → 0). */
export function pctValue(value: number | null | undefined): number {
  return value == null ? 0 : Math.round(value * 100);
}

/** Signed delta in percentage points: "+4pt", "−2pt"; null → `naLabel`. */
export function formatDeltaPts(value: number | null | undefined, naLabel: string): string {
  if (value == null) return naLabel;
  const pts = Math.round(value * 100);
  if (pts === 0) return "0pt";
  return `${pts > 0 ? "+" : "−"}${Math.abs(pts)}pt`;
}

/** Signed delta as a 0..1 fraction with two decimals ("0.04"), for KPI tiles. */
export function formatDeltaFraction(value: number | null | undefined): string | null {
  return value == null ? null : Math.abs(value).toFixed(2);
}

/** USD cost → "$0.23", or four decimals below one cent ("$0.0013"); null → `naLabel`. */
export function formatCost(value: number | null | undefined, naLabel: string): string {
  if (value == null) return naLabel;
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 0.01 ? 4 : 2)}`;
}

/** Magnitude of a USD delta with the same adaptive precision as `formatCost`. */
export function formatCostDelta(value: number): string {
  const abs = Math.abs(value);
  return abs !== 0 && abs < 0.01 ? abs.toFixed(4) : abs.toFixed(2);
}

/** ISO → "2026-05-29 09:14" in the viewer's local time. */
export function formatRanAt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ms → "1.8s" / "42ms". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** "v7" for a recorded agent version, "—" when the run predates versioning. */
export function formatVersion(version: number | null | undefined): string {
  return version == null ? "—" : `v${version}`;
}
