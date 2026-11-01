/* RunReviewDropdown — the PR page's Run Review menu. A popover with one
   checkbox per agent (model + estimate), preselecting the enabled ones. Exactly
   one agent runs through POST /pulls/:id/review; two or more start a
   multi-agent run and open its results page. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { EstimateLabel } from "@/components/estimate-label";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useLatestMultiAgentRun, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useRunReview } from "@/lib/hooks/reviews";
import { totalEstimate } from "@/lib/multi-agent-estimate";
import { FALLBACK_CAP } from "./constants";
import { defaultSelection, toggleId } from "./helpers";
import { s } from "./styles";
import { AgentPickRow } from "./_components/AgentPickRow";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a single-agent run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the single-agent run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const run = useRunReview();
  const startMulti = useStartMultiAgentRun();
  const [open, setOpen] = React.useState(false);
  // null = "the enabled agents" (derived, so it is re-applied every time the menu opens).
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const { data: latest } = useLatestMultiAgentRun(open ? prId : null);

  const all = agents ?? [];
  const selected = picked ?? defaultSelection(all);
  const total = totalEstimate(selected, estimates?.agents, estimates?.concurrency ?? FALLBACK_CAP);
  const busy = run.isPending || startMulti.isPending;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    listRef.current?.querySelector<HTMLElement>("[role=checkbox]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open) setPicked(null);
    setOpen((o) => !o);
  };

  const runSingle = async () => {
    const agentId = selected[0];
    if (!agentId) return;
    setOpen(false);
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, agentId });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
    } finally {
      onRunSettled?.();
    }
  };

  const runMulti = async () => {
    const res = await startMulti.mutateAsync({ prId, agentIds: selected });
    setOpen(false);
    router.push(`/repos/${repoId}/multi-agent/${res.multi_run_id}`);
  };

  return (
    <div ref={rootRef} style={s.root}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={busy}
          onClick={toggleOpen}
          aria-haspopup="true"
          aria-expanded={open}
        >
          {busy ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div role="group" aria-label={t("runReview.pickerLabel")} style={s.popover}>
          {warnMerged && (
            <div style={s.warning}>
              <Icon.AlertTriangle size={13} />
              <span>{t("runReview.mergedWarning")}</span>
            </div>
          )}
          <div style={s.header}>
            <span>{t("runReview.pickerLabel")}</span>
            <button type="button" style={s.link} onClick={() => setPicked([])}>
              {t("runReview.clear")}
            </button>
          </div>
          <div ref={listRef} style={s.list}>
            {all.length === 0 && <div style={s.empty}>{t("runReview.configureAgents")}</div>}
            {all.map((a) => (
              <AgentPickRow
                key={a.id}
                name={a.name}
                model={a.model}
                enabled={a.enabled}
                checked={selected.includes(a.id)}
                estimate={estimates?.agents.find((e) => e.agent_id === a.id)}
                onToggle={() => setPicked(toggleId(selected, a.id))}
              />
            ))}
          </div>
          <div style={s.footer}>
            <div style={s.total}>
              <span>{t("runReview.total")}</span>
              <EstimateLabel durationMs={total.durationMs} costUsd={total.costUsd} partial={total.partial} />
            </div>
            {selected.length === 1 && (
              <Button kind="secondary" size="sm" full disabled={busy} onClick={runSingle}>
                {t("runReview.runSingle")}
              </Button>
            )}
            <Button kind="primary" size="sm" full disabled={selected.length < 2 || busy} onClick={runMulti}>
              {t("runReview.runMulti", { count: selected.length })}
            </Button>
            <div style={s.footerLinks}>
              <button
                type="button"
                style={s.link}
                onClick={() => router.push(`/repos/${repoId}/multi-agent?pr=${number}`)}
              >
                {t("runReview.configureAgents")}
              </button>
              {latest && (
                <button
                  type="button"
                  style={s.link}
                  onClick={() => router.push(`/repos/${repoId}/multi-agent/${latest.id}`)}
                >
                  {t("runReview.latestRun")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
