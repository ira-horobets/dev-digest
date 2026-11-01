/* AgentSummaryCard — one agent's score, verdict text, duration, cost and View trace (Tabs view). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { formatDuration } from "@/lib/format-duration";
import { s } from "./styles";

export function AgentSummaryCard({ column, onTrace }: { column: AgentColumn; onTrace: (runId: string) => void }) {
  const t = useTranslations("runs");
  return (
    <div style={s.card}>
      {column.score != null && <CircularScore score={column.score} size={56} />}
      <div style={s.main}>
        {column.verdict && <span style={s.verdict}>{column.verdict.replace(/_/g, " ")}</span>}
        {column.summary ? <p style={s.summary}>{column.summary}</p> : <p style={s.muted}>{t("tabs.noSummary")}</p>}
        {(column.status === "failed" || column.status === "cancelled") && (
          <span role="alert" style={s.error}>
            {column.error ?? t("results.noError")}
          </span>
        )}
        <div style={s.stats}>
          <span className="tnum">{formatDuration(column.duration_ms)}</span>
          <RunCostBadge variant="compact" costUsd={column.cost_usd} />
        </div>
      </div>
      <Button kind="ghost" size="sm" onClick={() => onTrace(column.run_id)}>
        {t("viewTrace")}
      </Button>
    </div>
  );
}
