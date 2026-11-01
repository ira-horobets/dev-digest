/* TabsView — one tab per agent (score in the label, arrow keys move between
   tabs), the agent's summary card and its findings as expandable cards with
   persisted Accept / Dismiss. Learn and Turn into eval case are planned and
   shown disabled; there is no Reply to author here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { MultiAgentRun } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { useFindingAction, useRunFindings } from "@/lib/hooks/reviews";
import { AgentSummaryCard } from "../AgentSummaryCard";
import { nextTabIndex } from "./helpers";
import { s } from "./styles";

export function TabsView({ run, onTrace }: { run: MultiAgentRun; onTrace: (runId: string) => void }) {
  const t = useTranslations("runs");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const columns = run.columns;
  const selectedIndex = Math.max(0, columns.findIndex((c) => c.run_id === selectedId));
  const column = columns[selectedIndex];
  const { data: detail, isLoading } = useRunFindings(column?.run_id);
  const action = useFindingAction();

  if (!column) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = nextTabIndex(e.key, selectedIndex, columns.length);
    if (next === null) return;
    e.preventDefault();
    setSelectedId(columns[next]!.run_id);
    tabRefs.current[next]?.focus();
  };

  const planned = (
    <>
      <span title={t("tabs.comingSoon")}>
        <Button kind="ghost" size="sm" disabled>
          {t("tabs.learn")}
        </Button>
      </span>
      <span title={t("tabs.comingSoon")}>
        <Button kind="ghost" size="sm" disabled>
          {t("tabs.evalCase")}
        </Button>
      </span>
    </>
  );

  return (
    <div style={s.wrap}>
      <div role="tablist" aria-label={t("tabs.label")} style={s.tablist} onKeyDown={onKeyDown}>
        {columns.map((c, i) => (
          <button
            key={c.run_id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${c.run_id}`}
            aria-selected={i === selectedIndex}
            aria-controls={`panel-${c.run_id}`}
            tabIndex={i === selectedIndex ? 0 : -1}
            style={s.tab(i === selectedIndex)}
            onClick={() => setSelectedId(c.run_id)}
          >
            {c.agent_name}
            {c.score != null && <span style={s.score}>{c.score}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${column.run_id}`} aria-labelledby={`tab-${column.run_id}`} style={s.panel}>
        <AgentSummaryCard column={column} onTrace={onTrace} />
        <div style={s.findings}>
          {isLoading && <span style={s.muted}>{t("tabs.loadingFindings")}</span>}
          {!isLoading && (detail?.findings.length ?? 0) === 0 && column.status === "done" && (
            <span style={s.muted}>{t("tabs.noFindings")}</span>
          )}
          {detail?.findings.map((f) => (
            <FindingCard
              key={f.id}
              f={f}
              pending={action.isPending}
              onAction={(a, reply) => action.mutate({ findingId: f.id, action: a, prId: run.pr_id, ...(reply ? { reply } : {}) })}
              extraActions={planned}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
