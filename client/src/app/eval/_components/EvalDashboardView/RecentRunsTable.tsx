"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Icon } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { formatRanAt, formatVersion } from "../../../../lib/eval-format";
import { MetricBar, METRIC_COLORS } from "./MetricBar";
import { s } from "./styles";

/** The combined recent-runs table across every agent (suite runs only). */
export function RecentRunsTable({ runs, onOpenAgent }: { runs: EvalRunRecord[]; onOpenAgent: (agentId: string) => void }) {
  const t = useTranslations("eval");
  const na = t("notApplicable");

  if (runs.length === 0) {
    return <EmptyState icon="History" title={t("dashboard.recentRuns")} body={t("dashboard.noRuns")} />;
  }

  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th} scope="col">{t("dashboard.table.agent")}</th>
            <th style={s.th} scope="col">{t("dashboard.table.ranAt")}</th>
            <th style={s.th} scope="col">{t("dashboard.table.version")}</th>
            <th style={s.th} scope="col">{t("dashboard.table.recall")}</th>
            <th style={s.th} scope="col">{t("dashboard.table.precision")}</th>
            <th style={s.th} scope="col">{t("dashboard.table.citation")}</th>
            <th style={s.th} scope="col">{t("dashboard.table.pass")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} onClick={() => onOpenAgent(r.owner_id)} style={{ cursor: "pointer" }}>
              <td style={{ ...s.td, ...s.tdName }}>{r.agent_name ?? "—"}</td>
              <td style={{ ...s.td, ...s.mono }}>{formatRanAt(r.started_at)}</td>
              <td style={{ ...s.td, ...s.version }}>{formatVersion(r.agent_version)}</td>
              {r.status === "completed" ? (
                <>
                  <td style={s.td}><MetricBar value={r.metrics?.recall} color={METRIC_COLORS.recall} naLabel={na} /></td>
                  <td style={s.td}><MetricBar value={r.metrics?.precision} color={METRIC_COLORS.precision} naLabel={na} /></td>
                  <td style={s.td}><MetricBar value={r.metrics?.citation_accuracy} color={METRIC_COLORS.citation} naLabel={na} /></td>
                  <td style={{ ...s.td, ...s.pass }} className="tnum">
                    {r.metrics ? `${r.metrics.traces_passed}/${r.metrics.traces_total}` : na}
                  </td>
                </>
              ) : (
                <td style={s.td} colSpan={4}>
                  <RunStatus status={r.status} reason={r.error_reason} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunStatus({ status, reason }: { status: EvalRunRecord["status"]; reason?: string | null }) {
  const t = useTranslations("eval");
  if (status === "running") {
    return (
      <span style={s.status("var(--accent)")}>
        <Icon.RefreshCw size={12} style={{ animation: "ddspin 1s linear infinite" }} />
        {t("status.running")}
      </span>
    );
  }
  if (status === "errored") {
    return (
      <span style={s.status("var(--warn)")} title={reason ?? undefined}>
        <Icon.AlertTriangle size={12} />
        {t("status.errored")}
        {reason ? ` · ${reason}` : ""}
      </span>
    );
  }
  return (
    <span style={s.status("var(--ok)")}>
      <Icon.CheckCircle size={12} />
      {t("status.completed")}
    </span>
  );
}
