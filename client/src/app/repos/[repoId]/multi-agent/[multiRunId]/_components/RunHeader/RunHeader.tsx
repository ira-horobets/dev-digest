/* RunHeader — results header. Row 1: Configure run, the page title, the
   selected-agent count (progress while running) and the Columns / Tabs
   toggle. Row 2: the PR number and title, then the run totals (agents,
   parallel fan-out, total duration, total cost). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { MultiAgentRun } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { formatDuration } from "@/lib/format-duration";
import { s } from "./styles";

type View = "columns" | "tabs";

export function RunHeader({
  run,
  repoId,
  prTitle,
  view,
  onViewChange,
}: {
  run: MultiAgentRun;
  repoId: string;
  /** Title of the reviewed PR, when the PR list has loaded. */
  prTitle?: string;
  view: View;
  onViewChange: (view: View) => void;
}) {
  const t = useTranslations("runs");
  const running = run.status === "running";
  const done = run.columns.filter((c) => c.status === "done").length;
  const configureHref = `/repos/${repoId}/multi-agent${run.pr_number != null ? `?pr=${run.pr_number}` : ""}`;
  const views: View[] = ["columns", "tabs"];

  return (
    <header style={s.header}>
      <div style={s.topRow}>
        <div style={s.titleGroup}>
          <Link href={configureHref} style={s.configure}>
            <Icon.Settings size={13} aria-hidden />
            {t("results.configureRun")}
          </Link>
          <h1 style={s.title}>{t("page.title")}</h1>
          <span style={s.subtitle}>
            {running
              ? t("results.progress", { done, total: run.agent_count })
              : t("results.selectedAgents", { count: run.agent_count })}{" "}
            · {t("results.parallel")}
          </span>
        </div>
        <div role="group" aria-label={t("results.viewLabel")} style={s.toggle}>
          {views.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              style={s.toggleButton(view === v)}
              onClick={() => onViewChange(v)}
            >
              {t(v === "columns" ? "results.viewColumns" : "results.viewTabs")}
            </button>
          ))}
        </div>
      </div>

      <div style={s.prRow}>
        <div style={s.pr}>
          {run.pr_number != null && (
            <span className="mono" style={s.prNumber}>
              #{run.pr_number}
            </span>
          )}
          {prTitle && <span style={s.prTitle}>{prTitle}</span>}
        </div>
        <div style={s.totals}>
          <Icon.Workflow size={13} style={s.totalsIcon} aria-hidden />
          <span>{t("results.agents", { count: run.agent_count })}</span>
          <span aria-hidden>·</span>
          <span>{t("configure.fanOut")}</span>
          <span aria-hidden>·</span>
          <span className="tnum">
            {t("results.totalSuffix", { duration: running ? "…" : formatDuration(run.total_duration_ms) })}
          </span>
          <span aria-hidden>·</span>
          <RunCostBadge variant="compact" costUsd={run.total_cost_usd} />
        </div>
      </div>
    </header>
  );
}
