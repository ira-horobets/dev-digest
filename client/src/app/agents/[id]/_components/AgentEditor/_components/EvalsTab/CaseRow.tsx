"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn } from "@devdigest/ui";
import type { EvalCase, EvalCaseOutcome } from "@devdigest/shared";
import { expectedCount } from "./helpers";
import { s } from "./styles";

/** One eval case: status glyph, name, last outcome, expectation badge, actions. */
export function CaseRow({
  evalCase,
  outcome,
  runDisabled,
  onRun,
  onEdit,
  onDelete,
}: {
  evalCase: EvalCase;
  outcome: EvalCaseOutcome | null;
  runDisabled: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const exp = evalCase.expectation;
  const badge =
    exp.type === "must_not_flag"
      ? t("expectation.emptyBadge")
      : `${(exp.severity ?? "FINDING").toUpperCase()} · ${exp.category ?? "any"}`;

  let sub: string;
  if (!outcome) sub = t("evalsTab.neverRun");
  else if (outcome.status === "errored") sub = t("evalsTab.errored", { reason: outcome.error_reason ?? "" });
  else sub = t("evalsTab.expectedGot", { expected: expectedCount(exp), got: outcome.findings_matched });

  return (
    <div style={s.row} data-testid={`eval-case-${evalCase.name}`}>
      <StatusGlyph outcome={outcome} />
      <div style={s.rowMain}>
        <div style={s.rowName}>{evalCase.name}</div>
        <div style={s.rowSub}>{sub}</div>
      </div>
      <span style={s.rowBadge}>{badge}</span>
      <div style={s.rowActions}>
        <IconBtn icon="Play" label={t("evalsTab.runCase")} onClick={runDisabled ? undefined : onRun} />
        <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={onEdit} />
        <IconBtn icon="Trash" label={t("evalsTab.delete")} onClick={onDelete} danger />
      </div>
    </div>
  );
}

function StatusGlyph({ outcome }: { outcome: EvalCaseOutcome | null }) {
  if (!outcome || outcome.status === "errored" && outcome.pass === null && !outcome.error_reason) {
    return <Icon.Clock size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />;
  }
  if (outcome.status === "errored") {
    return <Icon.AlertTriangle size={18} style={{ color: "var(--warn)", flexShrink: 0 }} />;
  }
  return outcome.pass ? (
    <Icon.CheckCircle size={18} style={{ color: "var(--ok)", flexShrink: 0 }} />
  ) : (
    <Icon.XCircle size={18} style={{ color: "var(--crit)", flexShrink: 0 }} />
  );
}
