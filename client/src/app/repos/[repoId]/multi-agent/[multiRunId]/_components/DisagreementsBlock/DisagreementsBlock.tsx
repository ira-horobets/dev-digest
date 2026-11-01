/* DisagreementsBlock — "Where agents disagree": one card per location
   (file:line and topic), one cell per agent with its severity and note,
   "did not flag", or "no result". Hidden unless at least two agents
   completed. Finding text is rendered as plain text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, SEV, Toggle, type Severity } from "@devdigest/ui";
import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";
import { ROW_CAP } from "./constants";
import { locationLabel } from "./helpers";
import { s } from "./styles";

export function DisagreementsBlock({ conflicts, columns }: { conflicts: Conflict[]; columns: AgentColumn[] }) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const [shown, setShown] = React.useState(ROW_CAP);

  const completed = columns.filter((c) => c.status === "done").length;
  if (completed <= 1) return null;

  const rows = onlyConflicts ? conflicts.filter((c) => c.conflict) : conflicts;
  const visible = rows.slice(0, shown);
  const anyConflict = conflicts.some((c) => c.conflict);

  return (
    <section style={s.block} aria-labelledby="disagreements-title">
      <div style={s.head}>
        <h2 id="disagreements-title" style={s.title}>
          <Icon.Activity size={14} aria-hidden />
          {t("conflicts.title")}
        </h2>
        <label style={s.toggleLabel}>
          {t("conflicts.onlyConflicts")}
          <Toggle on={onlyConflicts} onChange={setOnlyConflicts} />
        </label>
      </div>
      {!anyConflict && <span style={s.note}>{t("conflicts.empty")}</span>}
      {onlyConflicts && rows.length === 0 && <span style={s.note}>{t("conflicts.onlyEmpty")}</span>}
      {visible.length > 0 && (
        <ul style={s.list}>
          {visible.map((c, i) => (
            <li key={`${c.file}:${c.line}:${i}`} style={s.card}>
              <div style={s.cardHead}>
                <Icon.Code size={13} style={s.codeIcon} aria-hidden />
                <span className="mono" style={s.loc}>
                  {locationLabel(c)}
                </span>
                <span style={s.topic}>{c.title}</span>
              </div>
              <div style={s.cells}>
                {columns.map((col) => (
                  <TakeCell key={col.run_id} agentName={col.agent_name} take={c.takes.find((x) => x.run_id === col.run_id)} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > visible.length && (
        <span style={s.more}>
          <Button kind="ghost" size="sm" onClick={() => setShown((n) => n + ROW_CAP)}>
            {t("conflicts.showMore", { count: rows.length - visible.length })}
          </Button>
        </span>
      )}
    </section>
  );
}

/** One agent's stance on a location: severity + note, "did not flag", or "no result". */
function TakeCell({ agentName, take }: { agentName: string; take: ConflictTake | undefined }) {
  const t = useTranslations("runs");
  const flagged = take && take.verdict !== "ignored" && take.verdict !== "no_result";
  const sev = flagged ? (SEV[take.verdict as Severity] ?? SEV.INFO) : null;

  return (
    <div style={s.cell}>
      <span style={s.agent}>{agentName}</span>
      {sev ? (
        <span style={s.verdict(sev.c, true)}>
          <span style={s.dot(sev.c)} aria-hidden />
          {sev.label}
        </span>
      ) : (
        <span style={s.verdict("var(--text-muted)", false)}>
          <span style={s.dot("var(--text-muted)")} aria-hidden />
          {!take || take.verdict === "no_result" ? t("conflicts.noResult") : t("conflicts.didNotFlag")}
        </span>
      )}
      {take?.note && <span style={s.cellNote}>{take.note}</span>}
    </div>
  );
}
