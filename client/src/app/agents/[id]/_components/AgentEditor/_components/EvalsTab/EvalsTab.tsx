"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCase } from "@devdigest/shared";
import {
  useDeleteEvalCase,
  useEvalAgentDetail,
  useEvalCases,
  useEvalRuns,
  useStartEvalRun,
} from "../../../../../../../lib/hooks/eval";
import { ApiError } from "../../../../../../../lib/api";
import { notify } from "../../../../../../../lib/toast";
import { MetricTiles } from "./MetricTiles";
import { CaseRow } from "./CaseRow";
import { CaseEditorModal } from "./CaseEditorModal";
import { passingCount } from "./helpers";
import { s } from "./styles";

/**
 * The agent editor's Evals tab: KPI tiles from the latest completed suite run
 * (with deltas vs the previous one), the case list with each case's most
 * recent outcome, "Run all evals", and the case editor modal. A run started
 * here executes in the background; the hooks poll until it settles.
 */
export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const { data: detail } = useEvalAgentDetail(agent.id, "all");
  const { data: runs } = useEvalRuns(agent.id);
  const startRun = useStartEvalRun();
  const deleteCase = useDeleteEvalCase();

  const [editor, setEditor] = React.useState<{ open: boolean; evalCase: EvalCase | null }>({ open: false, evalCase: null });

  const isRunning = (runs ?? []).some((r) => r.status === "running") || startRun.isPending;
  const outcomes = detail?.case_outcomes ?? {};
  const caseList = cases ?? [];
  const passed = passingCount(caseList, outcomes);

  const run = (caseIds?: string[]) => {
    startRun.mutate(
      { agentId: agent.id, caseIds },
      {
        onSuccess: (res) => notify.success(t("evalsTab.runStarted", { count: res.estimate.cases_total })),
        onError: (err) => notify.error(err instanceof ApiError ? err.message : t("evalsTab.runStartFailed")),
      },
    );
  };

  const remove = (evalCase: EvalCase) => {
    if (typeof window !== "undefined" && !window.confirm(t("evalsTab.deleteConfirm", { name: evalCase.name }))) return;
    deleteCase.mutate({ id: evalCase.id, agentId: agent.id }, { onSuccess: () => notify.success(t("evalsTab.caseDeleted")) });
  };

  return (
    <div style={s.wrap}>
      <section>
        <div style={s.sectionHead}>
          <span style={s.sectionLabel}>
            <Icon.Gauge size={14} />
            {t("evalsTab.metricsTitle")}
          </span>
          <button type="button" style={s.dashboardLink} onClick={() => router.push(`/eval/agents/${agent.id}`)}>
            {t("evalsTab.viewDashboard")}
          </button>
        </div>
        <MetricTiles run={detail?.current ?? null} delta={detail?.delta ?? { recall: null, precision: null, citation_accuracy: null }} />
        <div role="status" aria-live="polite" style={s.srOnly}>
          {isRunning ? t("evalsTab.running") : ""}
        </div>
      </section>

      <section>
        <div style={s.casesHead}>
          <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
          {caseList.length > 0 && (
            <span style={s.passingBadge}>{t("evalsTab.passing", { passed, total: caseList.length })}</span>
          )}
          <div style={s.headActions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              onClick={() => run()}
              disabled={isRunning || caseList.length === 0}
              loading={isRunning}
            >
              {isRunning ? t("evalsTab.running") : t("evalsTab.runAll")}
            </Button>
            <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditor({ open: true, evalCase: null })}>
              {t("evalsTab.newCase")}
            </Button>
          </div>
        </div>

        {casesLoading ? (
          <div style={s.list}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        ) : caseList.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("evalsTab.emptyTitle")} body={t("evalsTab.emptyBody")} />
        ) : (
          <div style={s.list}>
            {caseList.map((c) => (
              <CaseRow
                key={c.id}
                evalCase={c}
                outcome={outcomes[c.id] ?? null}
                runDisabled={isRunning}
                onRun={() => run([c.id])}
                onEdit={() => setEditor({ open: true, evalCase: c })}
                onDelete={() => remove(c)}
              />
            ))}
          </div>
        )}
      </section>

      {editor.open && (
        <CaseEditorModal
          agent={agent}
          evalCase={editor.evalCase}
          outcome={editor.evalCase ? (outcomes[editor.evalCase.id] ?? null) : null}
          runDisabled={isRunning}
          onClose={() => setEditor({ open: false, evalCase: null })}
          onRun={(id) => run([id])}
        />
      )}
    </div>
  );
}
