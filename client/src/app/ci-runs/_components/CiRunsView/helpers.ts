import type { CiRun } from "@devdigest/shared";
import { DEFAULT_RANGE, RANGE_VALUES, STATUS_VALUES, type Range } from "./constants";

export function parseRange(v: string | null): Range {
  return (RANGE_VALUES as readonly string[]).includes(v ?? "") ? (v as Range) : DEFAULT_RANGE;
}

export function parseStatus(v: string | null): CiRun["status"] | undefined {
  return (STATUS_VALUES as readonly string[]).includes(v ?? "") ? (v as CiRun["status"]) : undefined;
}

/** "1.2s", "3m 04s"; "—" when unknown. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** In-progress rows that match the active filters (they are never stored, so the server cannot filter them). */
export function visibleRunning(
  running: CiRun[],
  f: { agentId?: string; repo?: string; status?: string },
): CiRun[] {
  if (f.status && f.status !== "running") return [];
  return running.filter((r) => (!f.agentId || r.agent_id === f.agentId) && (!f.repo || r.repo === f.repo));
}

/** Is the rate-limit wait still running? */
export function isBlocked(retryAt: string | null | undefined, now: number = Date.now()): boolean {
  return !!retryAt && Date.parse(retryAt) > now;
}

/** Local wall-clock time of the rate-limit retry, for the banner. */
export function formatRetryTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}
