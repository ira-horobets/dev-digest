/* MultiRunView — results of one multi-agent run: header, Columns or Tabs view
   (kept in ?view=), the "Where agents disagree" block and the run trace drawer.
   Everything is rebuilt from the persisted run; live streams open only for
   columns whose run is still running. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { usePulls } from "@/lib/hooks/core";
import { multiAgentKey, useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { AgentColumn } from "../AgentColumn";
import { ColumnsView } from "../ColumnsView";
import { DisagreementsBlock } from "../DisagreementsBlock";
import { RunHeader } from "../RunHeader";
import { TabsView } from "../TabsView";
import { parseView } from "./helpers";
import { s } from "./styles";

export function MultiRunView({ repoId, multiRunId }: { repoId: string; multiRunId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: run, isLoading, isError, error, refetch } = useMultiAgentRun(multiRunId);
  const { data: pulls } = usePulls(repoId);
  const prTitle = pulls?.find((p) => p.number === run?.pr_number)?.title;
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);
  const view = parseView(search.get("view"));

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    ...(run?.pr_number != null ? [{ label: `#${run.pr_number}`, mono: true }] : []),
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const setView = (next: "columns" | "tabs") => router.replace(`/repos/${repoId}/multi-agent/${multiRunId}?view=${next}`);
  const refetchRun = () => qc.invalidateQueries({ queryKey: multiAgentKey(multiRunId) });

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div style={s.skeletons} aria-busy="true">
        <Skeleton height={32} width={420} />
        <Skeleton height={240} />
      </div>
    );
  } else if (isError && error instanceof ApiError && error.status === 404) {
    body = <EmptyState icon="Layers" title={t("results.notFoundTitle")} body={t("results.notFoundBody")} />;
  } else if (isError || !run) {
    body = <ErrorState title={t("results.loadError")} onRetry={() => refetch()} />;
  } else {
    const traceColumn = run.columns.find((c) => c.run_id === traceRunId);
    body = (
      <div style={s.page}>
        <RunHeader run={run} repoId={repoId} prTitle={prTitle} view={view} onViewChange={setView} />
        {view === "columns" ? (
          <ColumnsView>
            {run.columns.map((c) => (
              <AgentColumn key={c.run_id} column={c} onTrace={setTraceRunId} onStreamEnd={refetchRun} />
            ))}
          </ColumnsView>
        ) : (
          <TabsView run={run} onTrace={setTraceRunId} />
        )}
        <DisagreementsBlock conflicts={run.conflicts} columns={run.columns} />
        {traceColumn && (
          <RunTraceDrawer
            runId={traceColumn.run_id}
            agentName={traceColumn.agent_name}
            prNumber={run.pr_number ?? null}
            running={traceColumn.status === "running"}
            onClose={() => setTraceRunId(null)}
          />
        )}
      </div>
    );
  }

  return <AppShell crumb={crumb}>{body}</AppShell>;
}
