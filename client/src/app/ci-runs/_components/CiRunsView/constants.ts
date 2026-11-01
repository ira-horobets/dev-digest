import type { CiRunStatus } from "@devdigest/shared";

export const RANGE_VALUES = ["24h", "7d", "30d"] as const;
export type Range = (typeof RANGE_VALUES)[number];
export const DEFAULT_RANGE: Range = "7d";

/** i18n key suffix of each range under `ci.runs.filters`. */
export const RANGE_LABEL_KEY: Record<Range, string> = { "24h": "last24h", "7d": "last7Days", "30d": "last30Days" };

export const STATUS_VALUES: readonly CiRunStatus[] = ["succeeded", "no_findings", "failed", "running"];
/** i18n key suffix of each status under `ci.runs.status`. */
export const STATUS_LABEL_KEY: Record<CiRunStatus, string> = {
  succeeded: "succeeded",
  no_findings: "noFindings",
  failed: "failed",
  running: "running",
};
