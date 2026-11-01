/* /ci-runs — agent reviews executed inside CI. Filters live in the URL; stored
   rows come from the API, new runs are pulled from GitHub on Refresh and every
   60 s while the tab is visible. */
"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, Toggle } from "@devdigest/ui";
import type { CiRunStatus } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useRepos } from "@/lib/hooks/core";
import { useAutoRefreshCiRuns, useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { CiRunRow } from "./_components/CiRunRow";
import {
  RANGE_LABEL_KEY,
  RANGE_VALUES,
  STATUS_LABEL_KEY,
  STATUS_VALUES,
} from "./constants";
import { formatRetryTime, isBlocked, parseRange, parseStatus, visibleRunning } from "./helpers";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = parseRange(params.get("range"));
  const agentId = params.get("agent") ?? undefined;
  const repo = params.get("repo") ?? undefined;
  const status = parseStatus(params.get("status")) ?? undefined;

  const { data: agents = [] } = useAgents();
  const { data: repos = [] } = useRepos();
  const runs = useCiRuns({ range, agent_id: agentId, repo, status: status as CiRunStatus | undefined });
  const refresh = useRefreshCiRuns();
  const [auto, setAuto] = React.useState(true);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const retryAt = refresh.data?.retry_at ?? null;
  const blocked = isBlocked(retryAt);
  useAutoRefreshCiRuns(() => refresh.mutate(), { enabled: auto, retryAt });

  const stored = runs.data?.runs ?? [];
  const running = visibleRunning(refresh.data?.running ?? [], { agentId, repo, status });
  const rows = [...running, ...stored];
  const errorRepos = (refresh.data?.errors ?? []).map((e) => e.repo).join(", ");

  const crumb = [{ label: t("page.crumb") }];
  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.sub}>{t("runs.subtitle")}</p>
            <p style={s.sub}>{t("runs.reportedNote")}</p>
          </div>
          <span style={s.spacer} />
          <label style={s.toggle}>
            <Toggle on={auto} onChange={setAuto} size={16} />
            {t("runs.autoRefresh")}
          </label>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || blocked}
          >
            {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
          </Button>
        </div>

        <div style={s.filters}>
          <select aria-label={t("runs.filters.range")} style={s.select} value={range} onChange={(e) => setParam("range", e.target.value)}>
            {RANGE_VALUES.map((v) => (
              <option key={v} value={v}>
                {t(`runs.filters.${RANGE_LABEL_KEY[v]}`)}
              </option>
            ))}
          </select>
          <select aria-label={t("runs.filters.agent")} style={s.select} value={agentId ?? ""} onChange={(e) => setParam("agent", e.target.value)}>
            <option value="">{t("runs.filters.allAgents")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select aria-label={t("runs.filters.repo")} style={s.select} value={repo ?? ""} onChange={(e) => setParam("repo", e.target.value)}>
            <option value="">{t("runs.filters.allRepos")}</option>
            {repos.map((r) => (
              <option key={r.id} value={r.full_name}>
                {r.full_name}
              </option>
            ))}
          </select>
          <select aria-label={t("runs.filters.status")} style={s.select} value={status ?? ""} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">{t("runs.filters.allStatuses")}</option>
            {STATUS_VALUES.map((v) => (
              <option key={v} value={v}>
                {t(`runs.status.${STATUS_LABEL_KEY[v]}`)}
              </option>
            ))}
          </select>
        </div>

        {blocked && retryAt && (
          <div role="status" style={s.banner}>
            {t("runs.retryBanner", { time: formatRetryTime(retryAt) })}
          </div>
        )}
        {errorRepos && (
          <div role="status" style={s.banner}>
            {t("runs.refreshErrors", { repos: errorRepos })}
          </div>
        )}

        {runs.isLoading ? (
          <Skeleton height={160} />
        ) : runs.isError ? (
          <ErrorState title={t("runs.loadError")} onRetry={() => runs.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                {(["timestamp", "repository", "pullRequest", "agent", "verdict", "findings", "cost", "duration", "status", "job"] as const).map((c) => (
                  <th key={c} scope="col" style={s.th}>
                    {t(`runs.table.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <CiRunRow key={r.id} run={r} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
