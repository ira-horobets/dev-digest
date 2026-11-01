/* CiStatusBadge — one badge for secret states, CI run statuses and PR states.
   Colours come from CSS variables only. */
import React from "react";
import { Badge } from "@devdigest/ui";

export type CiBadgeKind =
  | "ready"
  | "not_set"
  | "unknown"
  | "succeeded"
  | "no_findings"
  | "failed"
  | "running"
  | "open"
  | "merged"
  | "closed";

const TONES: Record<CiBadgeKind, { color: string; bg: string }> = {
  ready: { color: "var(--ok)", bg: "var(--ok-bg)" },
  succeeded: { color: "var(--ok)", bg: "var(--ok-bg)" },
  merged: { color: "var(--ok)", bg: "var(--ok-bg)" },
  no_findings: { color: "var(--ok)", bg: "var(--ok-bg)" },
  not_set: { color: "var(--crit)", bg: "var(--crit-bg)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  unknown: { color: "var(--warn)", bg: "var(--warn-bg)" },
  closed: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
  running: { color: "var(--info)", bg: "var(--info-bg)" },
  open: { color: "var(--info)", bg: "var(--info-bg)" },
};

export function CiStatusBadge({ kind, label }: { kind: CiBadgeKind; label: string }) {
  const tone = TONES[kind];
  return (
    <Badge color={tone.color} bg={tone.bg} dot>
      {label}
    </Badge>
  );
}
