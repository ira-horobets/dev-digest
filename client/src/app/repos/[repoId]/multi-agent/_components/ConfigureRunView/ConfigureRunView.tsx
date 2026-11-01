/* ConfigureRunView — /repos/:repoId/multi-agent. Step 1 picks the pull request
   (kept in ?pr=), step 2 the agents; the footer starts the run and opens its
   results page. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePulls } from "@/lib/hooks/core";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useRepoNotFound } from "@/lib/repo-context";
import { totalEstimate } from "@/lib/multi-agent-estimate";
import { AgentSelectStep } from "../AgentSelectStep";
import { PrSelectStep } from "../PrSelectStep";
import { defaultSelection, isMergedOrClosed, pullByNumber, selectablePulls, toggleId } from "./helpers";
import { s } from "./styles";

export function ConfigureRunView({ repoId }: { repoId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const search = useSearchParams();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const start = useStartMultiAgentRun();
  // null = "the enabled agents" until the user changes the list (derived, never synced).
  const [picked, setPicked] = React.useState<string[] | null>(null);

  const pr = pullByNumber(pulls, search.get("pr"));
  const all = agents ?? [];
  const selected = picked ?? defaultSelection(all);
  const total = totalEstimate(selected, estimates?.agents, estimates?.concurrency ?? 1);

  const crumb = [{ label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` }, { label: t("configure.crumb") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const onPickPr = (value: string) => router.replace(`/repos/${repoId}/multi-agent?pr=${value}`);
  const onRun = async () => {
    if (!pr?.id) return;
    const res = await start.mutateAsync({ prId: pr.id, agentIds: selected });
    router.push(`/repos/${repoId}/multi-agent/${res.multi_run_id}`);
  };

  return (
    <AppShell crumb={crumb}>
      <div style={s.column}>
        <PageContainer title={t("configure.title")} subtitle={t("configure.subtitle")}>
          <div style={s.page}>
            <PrSelectStep pulls={selectablePulls(pulls)} value={pr ? String(pr.number) : ""} onChange={onPickPr} />
            {isMergedOrClosed(pr) && (
              <div style={s.warning}>
                <Icon.AlertTriangle size={14} />
                <span>{t("configure.mergedWarning")}</span>
              </div>
            )}
            <AgentSelectStep
              agents={all}
              estimates={estimates?.agents}
              selected={selected}
              hasPr={!!pr}
              total={total}
              pending={start.isPending}
              onToggle={(id) => setPicked(toggleId(selected, id))}
              onSelectAll={() => setPicked(all.map((a) => a.id))}
              onRun={onRun}
            />
          </div>
        </PageContainer>
      </div>
    </AppShell>
  );
}
