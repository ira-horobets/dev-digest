"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Dropdown, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { useEvalAgentDetail, useStartEvalRun } from "../../../../../../lib/hooks/eval";
import { useAgents } from "../../../../../../lib/hooks/agents";
import { ApiError } from "../../../../../../lib/api";
import { notify } from "../../../../../../lib/toast";
import { formatDeltaFraction, formatPct } from "../../../../../../lib/eval-format";
import { CalloutBanner } from "./CalloutBanner";
import { TrendChart } from "./TrendChart";
import { RunHistoryTable } from "./RunHistoryTable";
import { CompareModal } from "./CompareModal";
import { s } from "./styles";

type Range = 7 | 30 | 90 | "all";
const RANGES: Range[] = [7, 30, 90, "all"];

/**
 * /eval/agents/:agentId — one agent's regression harness: callout, KPI
 * tiles with deltas + sparklines, the metric trend, and the run history with
 * two-run selection feeding the compare modal.
 */
export function EvalAgentDetailView() {
  const { agentId } = useParams<{ agentId: string }>();
  const router = useRouter();
  const t = useTranslations("eval");
  const [range, setRange] = React.useState<Range>(30);
  const [comparePair, setComparePair] = React.useState<[string, string] | null>(null);

  const { data, isLoading, isError, refetch } = useEvalAgentDetail(agentId, range);
  const { data: agents } = useAgents();
  const startRun = useStartEvalRun();
  const na = t("notApplicable");

  const isRunning = (data?.runs ?? []).some((r) => r.status === "running") || startRun.isPending;
  const runNow = () =>
    startRun.mutate(
      { agentId },
      {
        onSuccess: (res) => notify.success(t("evalsTab.runStarted", { count: res.estimate.cases_total })),
        onError: (err) => notify.error(err instanceof ApiError ? err.message : t("evalsTab.runStartFailed")),
      },
    );

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: data?.agent_name ?? t("page.crumbEvals") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen body={t("detail.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const trendOf = (key: "recall" | "precision" | "citation_accuracy") => (data?.trend ?? []).map((p) => p[key] ?? 0);
  const deltaOf = (v: number | null | undefined) => (v == null ? undefined : v);

  return (
    <AppShell crumb={crumb}>
      {comparePair && (
        <CompareModal agentId={agentId} a={comparePair[0]} b={comparePair[1]} onClose={() => setComparePair(null)} />
      )}
      <div style={s.page}>
        <button type="button" style={s.back} onClick={() => router.push("/eval")}>
          <Icon.ChevronLeft size={16} />
          {t("detail.back")}
        </button>

        <div style={s.header}>
          <div style={s.headerText}>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{data?.agent_name ?? (isLoading ? "…" : "")}</h1>
              {data && (
                <Badge mono color="var(--text-secondary)">
                  {data.model}
                </Badge>
              )}
            </div>
            {data && (
              <p style={s.subtitle}>
                {t("detail.subtitle", { runs: data.runs.filter((r) => r.status === "completed").length, cases: data.cases_total })}
              </p>
            )}
          </div>
          <div style={s.headerActions}>
            {agents && agents.length > 1 && (
              <Dropdown
                width={240}
                align="right"
                trigger={
                  <Button kind="secondary" icon="Cpu" iconRight="ChevronDown">
                    {data?.agent_name ?? "…"}
                  </Button>
                }
                items={agents.map((a) => ({
                  label: a.name,
                  icon: "Cpu" as const,
                  onClick: () => router.push(`/eval/agents/${a.id}`),
                }))}
              />
            )}
            <Dropdown
              width={160}
              align="right"
              trigger={
                <Button kind="secondary" icon="Calendar" iconRight="ChevronDown">
                  {t(`detail.range.${range}`)}
                </Button>
              }
              items={RANGES.map((r) => ({ label: t(`detail.range.${r}`), onClick: () => setRange(r) }))}
            />
            <Button kind="primary" icon="Play" onClick={runNow} disabled={isRunning || !data || data.cases_total === 0} loading={isRunning}>
              {isRunning ? t("detail.running") : t("detail.runEval")}
            </Button>
          </div>
        </div>

        {isLoading && (
          <>
            <Skeleton height={110} style={{ marginBottom: 22 }} />
            <Skeleton height={260} />
          </>
        )}

        {data && (
          <>
            {data.callout && <CalloutBanner callout={data.callout} />}

            <div style={s.tiles}>
              <MetricCard
                label={t("metrics.recall").toUpperCase()}
                value={formatPct(data.current?.recall, na)}
                delta={deltaOf(data.delta.recall)}
                color="var(--accent)"
                trend={trendOf("recall")}
              />
              <MetricCard
                label={t("metrics.precision").toUpperCase()}
                value={formatPct(data.current?.precision, na)}
                delta={deltaOf(data.delta.precision)}
                color="var(--ok)"
                trend={trendOf("precision")}
              />
              <MetricCard
                label={t("metrics.citationAccuracy").toUpperCase()}
                value={formatPct(data.current?.citation_accuracy, na)}
                delta={deltaOf(data.delta.citation_accuracy)}
                color="var(--warn)"
                trend={trendOf("citation_accuracy")}
              />
            </div>
            <span style={s.srOnly}>
              {formatDeltaFraction(data.delta.recall) ?? ""}
            </span>

            <TrendChart trend={data.trend} />

            <RunHistoryTable runs={data.runs} onCompare={(a, b) => setComparePair([a, b])} />
          </>
        )}
      </div>
    </AppShell>
  );
}
