"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Skeleton, ErrorState, Icon } from "@devdigest/ui";
import type { EvalCompare } from "@devdigest/shared";
import { useEvalCompare } from "../../../../../../lib/hooks/eval";
import { useAgent, useUpdateAgent } from "../../../../../../lib/hooks/agents";
import { ApiError } from "../../../../../../lib/api";
import { notify } from "../../../../../../lib/toast";
import { formatCost, formatCostDelta, formatPct, formatVersion } from "../../../../../../lib/eval-format";
import { s } from "./styles";

/**
 * Two runs side by side (older → newer): metric deltas over the common case
 * set, the cases that flipped, and the system-prompt line diff between the
 * two agent versions. "Promote" writes the newer run's prompt back onto the
 * agent (a new version) when it differs from the current prompt.
 */
export function CompareModal({ agentId, a, b, onClose }: { agentId: string; a: string; b: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data: cmp, isLoading, isError } = useEvalCompare(a, b);
  const { data: agent } = useAgent(agentId);
  const update = useUpdateAgent();
  const na = t("notApplicable");

  const vA = cmp ? formatVersion(cmp.a.agent_version) : "";
  const vB = cmp ? formatVersion(cmp.b.agent_version) : "";
  const canPromote = !!cmp?.prompt_b && !!agent && cmp.prompt_b !== agent.system_prompt;

  const promote = () => {
    if (!cmp?.prompt_b || !agent) return;
    update.mutate(
      { id: agent.id, patch: { system_prompt: cmp.prompt_b } },
      {
        onSuccess: (saved) => {
          notify.success(t("compare.promoted", { version: vB, newVersion: saved.version }));
          onClose();
        },
        onError: (err) => notify.error(err instanceof ApiError ? err.message : t("compare.promoteFailed")),
      },
    );
  };

  return (
    <Modal
      width={900}
      title={cmp ? t("compare.title", { a: vA, b: vB }) : t("detail.compare")}
      subtitle={cmp ? t("compare.subtitle", { cases: cmp.common_case_ids.length }) : undefined}
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
          {cmp && (
            <Button kind="primary" icon="GitBranch" disabled={!canPromote} loading={update.isPending} onClick={promote}>
              {canPromote || !agent ? t("compare.promote", { version: vB }) : t("compare.promoteCurrent", { version: vB })}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.modalBody}>
        {isLoading && <Skeleton height={200} />}
        {isError && <ErrorState body={t("compare.loadError")} />}
        {cmp && (
          <>
            <div style={s.deltaTiles}>
              <DeltaTile
                label={t("metrics.recall")}
                from={formatPct(metricsOf(cmp, "a").recall, na)}
                to={formatPct(metricsOf(cmp, "b").recall, na)}
                delta={cmp.deltas.recall}
                color="var(--accent)"
                unit="pt"
              />
              <DeltaTile
                label={t("metrics.precision")}
                from={formatPct(metricsOf(cmp, "a").precision, na)}
                to={formatPct(metricsOf(cmp, "b").precision, na)}
                delta={cmp.deltas.precision}
                color="var(--ok)"
                unit="pt"
              />
              <DeltaTile
                label={t("metrics.citation")}
                from={formatPct(metricsOf(cmp, "a").citation_accuracy, na)}
                to={formatPct(metricsOf(cmp, "b").citation_accuracy, na)}
                delta={cmp.deltas.citation_accuracy}
                color="var(--warn)"
                unit="pt"
              />
              <DeltaTile
                label={t("metrics.cost")}
                from={formatCost(cmp.a.cost_usd, na)}
                to={formatCost(cmp.b.cost_usd, na)}
                delta={cmp.deltas.cost_usd}
                color="var(--text-primary)"
                unit="usd"
              />
            </div>

            {(cmp.only_in_a.length > 0 || cmp.only_in_b.length > 0) && (
              <p style={s.hint}>
                {t("compare.caseSetChanged", {
                  onlyA: cmp.only_in_a.length,
                  onlyB: cmp.only_in_b.length,
                  common: cmp.common_case_ids.length,
                })}
              </p>
            )}

            {cmp.case_transitions.length > 0 && (
              <div>
                <div style={s.sectionLabel}>{t("compare.transitions")}</div>
                <ul style={{ ...s.transitions, marginTop: 8 }}>
                  {cmp.case_transitions.map((c) => (
                    <li key={c.case_id}>{t(c.to ? "callout.nowPassing" : "callout.nowFailing", { name: c.name })}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div style={{ ...s.sectionLabel, marginBottom: 10 }}>
                <Icon.FileText size={14} />
                {t("compare.promptDiff")}
              </div>
              <div style={s.diffLegend}>
                <span>
                  <span style={s.swatch("rgba(239,68,68,0.35)")} />
                  {t("compare.oldLegend", { version: vA })}
                </span>
                <span>
                  <span style={s.swatch("rgba(34,197,94,0.35)")} />
                  {t("compare.newLegend", { version: vB })}
                </span>
              </div>
              {cmp.prompt_a == null || cmp.prompt_b == null ? (
                <p style={s.hint}>{t("compare.noPrompt")}</p>
              ) : cmp.prompt_diff.every((l) => l.kind === "context") ? (
                <>
                  <p style={s.hint}>{t("compare.noPromptDiff")}</p>
                  <pre style={s.pre}>{cmp.prompt_b}</pre>
                </>
              ) : (
                <pre style={s.pre} data-testid="prompt-diff">
                  {cmp.prompt_diff.map((line, i) => (
                    <div key={i} style={s.diffLine(line.kind)}>
                      {line.text || " "}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Metrics of one side; the stored full-set metrics (already shown in the table). */
function metricsOf(cmp: EvalCompare, side: "a" | "b") {
  return cmp[side].metrics ?? { recall: null, precision: null, citation_accuracy: null };
}

function DeltaTile({
  label,
  from,
  to,
  delta,
  color,
  unit,
}: {
  label: string;
  from: string;
  to: string;
  delta: number | null;
  color: string;
  unit: "pt" | "usd";
}) {
  const t = useTranslations("eval");
  let deltaText = t("notApplicable");
  let deltaColor = "var(--text-muted)";
  let Arrow = Icon.Slash;
  if (delta != null) {
    const magnitude = unit === "pt" ? Math.round(Math.abs(delta) * 100) : formatCostDelta(delta);
    const unitLabel = unit === "pt" ? "pt" : "";
    deltaText = `${magnitude}${unitLabel}`;
    if (delta > 0) (deltaColor = unit === "usd" ? "var(--warn)" : "var(--ok)"), (Arrow = Icon.ArrowUp);
    else if (delta < 0) (deltaColor = unit === "usd" ? "var(--ok)" : "var(--crit)"), (Arrow = Icon.ArrowDown);
  }
  return (
    <div style={s.deltaTile}>
      <div style={s.deltaLabel}>{label}</div>
      <div style={s.deltaRow}>
        <span className="tnum">{from}</span>
        <Icon.ArrowRight size={14} />
        <span className="tnum" style={s.deltaNew(color)}>
          {to}
        </span>
        <span className="tnum" style={{ ...s.deltaPts(deltaColor), display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Arrow size={12} />
          {deltaText}
        </span>
      </div>
    </div>
  );
}
