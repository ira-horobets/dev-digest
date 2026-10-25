"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useEvalDashboard } from "@/lib/hooks/eval";
import { AgentSummaryRow } from "./AgentSummaryRow";
import { RecentRunsTable } from "./RecentRunsTable";
import { RunAllModal } from "./RunAllModal";
import { s } from "./styles";

/**
 * /eval — the regression harness across every reviewer agent: one row per
 * agent (latest metrics + recall trend), the combined recent-runs table and
 * the run-all action with its confirmation. Workspace-scoped, not per repo.
 */
export function EvalDashboardView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useEvalDashboard();
  const [runAllOpen, setRunAllOpen] = React.useState(false);

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];
  const anyRunning = (data?.recent_runs ?? []).some((r) => r.status === "running");

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen body={t("dashboard.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {runAllOpen && data && <RunAllModal agents={data.agents} onClose={() => setRunAllOpen(false)} />}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("dashboard.title")}</h1>
            <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
          </div>
          <Button kind="primary" icon="Play" onClick={() => setRunAllOpen(true)} disabled={isLoading || anyRunning} loading={anyRunning}>
            {anyRunning ? t("dashboard.running") : t("dashboard.runAll")}
          </Button>
        </div>

        <div style={s.section}>
          <div style={s.sectionLabel}>
            <Icon.Cpu size={14} />
            {t("dashboard.agents")}
          </div>
          {isLoading && (
            <div style={s.list}>
              <Skeleton height={76} />
              <Skeleton height={76} />
            </div>
          )}
          {!isLoading && data && data.agents.length === 0 && (
            <EmptyState icon="Cpu" title={t("dashboard.noAgents")} body={t("dashboard.noAgentsBody")} cta={t("page.crumbAgents")} onCta={() => router.push("/agents")} />
          )}
          {!isLoading && data && data.agents.length > 0 && (
            <div style={s.list}>
              {data.agents.map((a) => (
                <AgentSummaryRow key={a.agent_id} agent={a} onOpen={() => router.push(`/eval/agents/${a.agent_id}`)} />
              ))}
            </div>
          )}
        </div>

        {!isLoading && data && (
          <div style={s.section}>
            <div style={s.sectionLabel}>
              <Icon.History size={14} />
              {t("dashboard.recentRuns")}
            </div>
            <RecentRunsTable runs={data.recent_runs} onOpenAgent={(id) => router.push(`/eval/agents/${id}`)} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
