"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { formatPct, formatRanAt, formatVersion } from "../../../../lib/eval-format";
import { METRIC_COLORS } from "./MetricBar";
import { s } from "./styles";

/** One dashboard row: agent, last-run line, recall sparkline, the three metrics. */
export function AgentSummaryRow({ agent, onOpen }: { agent: EvalAgentSummary; onOpen: () => void }) {
  const t = useTranslations("eval");
  const na = t("notApplicable");
  const latest = agent.latest?.metrics ?? null;
  const meta = agent.latest
    ? t("dashboard.lastRun", {
        version: formatVersion(agent.latest.agent_version),
        date: formatRanAt(agent.latest.started_at),
        passed: latest?.traces_passed ?? 0,
        total: latest?.traces_total ?? 0,
      })
    : t("dashboard.noRunsYet", { cases: agent.cases_total });

  return (
    <button type="button" style={s.agentRow(agent.enabled)} onClick={onOpen} aria-label={t("dashboard.openAgent", { agent: agent.agent_name })}>
      <div style={s.iconBox}>
        <Icon.Cpu size={18} />
      </div>
      <div style={s.agentMain}>
        <div style={s.agentNameRow}>
          <span style={s.agentName}>{agent.agent_name}</span>
          <Badge mono color="var(--text-secondary)">
            {agent.model}
          </Badge>
        </div>
        <div style={s.agentMeta}>{meta}</div>
      </div>
      <div style={s.spark}>
        {agent.trend.length > 1 && <Sparkline data={agent.trend.map((p) => p.recall ?? 0)} w={80} h={26} />}
      </div>
      <div style={s.metricCol}>
        <div style={s.metricLabel}>{t("metrics.recallShort")}</div>
        <div className="tnum" style={s.metricVal(METRIC_COLORS.recall)}>
          {formatPct(latest?.recall, na)}
        </div>
      </div>
      <div style={s.metricCol}>
        <div style={s.metricLabel}>{t("metrics.precisionShort")}</div>
        <div className="tnum" style={s.metricVal(METRIC_COLORS.precision)}>
          {formatPct(latest?.precision, na)}
        </div>
      </div>
      <div style={s.metricCol}>
        <div style={s.metricLabel}>{t("metrics.citationShort")}</div>
        <div className="tnum" style={s.metricVal(METRIC_COLORS.citation)}>
          {formatPct(latest?.citation_accuracy, na)}
        </div>
      </div>
      <Icon.ChevronRight size={16} style={s.chevron} />
    </button>
  );
}
