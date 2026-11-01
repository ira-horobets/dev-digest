/* Step 3 — triggers, how results are posted, expected secrets, cost note. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, FormField } from "@devdigest/ui";
import type { CiPostAs, CiSecretStatus, CiTrigger } from "@devdigest/shared";
import { OptionCard, OptionGroup } from "@/components/option-card";
import { CiStatusBadge } from "@/components/ci-status-badge";
import { formatCost } from "@/lib/format-cost";
import { POST_AS_LABEL_KEY, POST_AS_VALUES, TRIGGER_VALUES } from "../../constants";
import { toggleInOrder } from "../../helpers";
import { s } from "./styles";

export interface ConfigureStepProps {
  triggers: CiTrigger[];
  onTriggers: (next: CiTrigger[]) => void;
  postAs: CiPostAs;
  onPostAs: (next: CiPostAs) => void;
  secrets: CiSecretStatus[] | undefined;
  secretsLoading: boolean;
  /** Agent card stats: runs completed and the average cost per run. */
  runs: number;
  avgCostUsd: number | null | undefined;
}

export function ConfigureStep(p: ConfigureStepProps) {
  const t = useTranslations("ci.exportWizard");
  const hasHistory = p.runs > 0 && p.avgCostUsd != null;
  return (
    <>
      <FormField label={t("triggerLabel")} hint={t("triggerHint")}>
        <div style={s.col}>
          {TRIGGER_VALUES.map((v) => (
            <Checkbox
              key={v}
              checked={p.triggers.includes(v)}
              onChange={() => p.onTriggers(toggleInOrder(p.triggers, v, TRIGGER_VALUES))}
              label={t(`triggers.${v}`)}
            />
          ))}
          {p.triggers.length === 0 && (
            <div role="alert" style={s.alert}>
              {t("triggerNone")}
            </div>
          )}
        </div>
      </FormField>
      <FormField label={t("postResultsLabel")}>
        <OptionGroup label={t("postResultsLabel")}>
          {POST_AS_VALUES.map((v) => (
            <OptionCard
              key={v}
              title={t(`postAs.${POST_AS_LABEL_KEY[v]}`)}
              tag={v === "github_review" ? t("recommended") : undefined}
              selected={p.postAs === v}
              onSelect={() => p.onPostAs(v)}
            />
          ))}
        </OptionGroup>
        {p.postAs === "github_review" && <div style={s.hint}>{t("reviewHint")}</div>}
      </FormField>
      <section aria-label={t("secretsTitle")} style={s.box}>
        <h3 style={s.heading}>{t("secretsTitle")}</h3>
        <div style={s.note}>{t("secretNote")}</div>
        {p.secretsLoading && <div style={s.note}>{t("secretsLoading")}</div>}
        <ul style={s.secrets}>
          {(p.secrets ?? []).map((sec) => (
            <li key={sec.name} style={s.secretRow}>
              <code>{sec.name}</code>
              <CiStatusBadge kind={sec.state} label={t(`secretStates.${sec.state}`)} />
              {sec.reason && <span style={s.note}>{sec.reason}</span>}
            </li>
          ))}
        </ul>
      </section>
      <div style={s.info}>{t("infoBox")}</div>
      <div style={s.note}>
        {hasHistory ? t("costLine", { cost: formatCost(p.avgCostUsd) }) : t("noRunHistory")}
      </div>
    </>
  );
}
