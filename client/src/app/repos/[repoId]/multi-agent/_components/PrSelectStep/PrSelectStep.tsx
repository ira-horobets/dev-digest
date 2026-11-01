/* PrSelectStep — step 1 of the Configure run screen: choose the pull request. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SearchableSelect } from "@devdigest/ui";
import type { PrMeta } from "@devdigest/shared";
import { StepHeading } from "../StepHeading";
import { s } from "./styles";

export function PrSelectStep({
  pulls,
  value,
  onChange,
}: {
  pulls: PrMeta[];
  /** PR number as a string, or "" when none is selected. */
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("runs");
  const options = pulls.map((p) => ({
    value: String(p.number),
    label: t("configure.prItem", { number: p.number, title: p.title }),
  }));
  return (
    <section style={s.step} aria-labelledby="multi-step-pr">
      <StepHeading id="multi-step-pr" step={1} title={t("configure.step1")} />
      <div style={s.body}>
        {pulls.length === 0 ? (
          <span style={s.muted}>{t("configure.noPrs")}</span>
        ) : (
          <div style={s.select}>
            <SearchableSelect
              value={value}
              onChange={onChange}
              options={options}
              placeholder={t("configure.prPlaceholder")}
              mono={false}
            />
          </div>
        )}
      </div>
    </section>
  );
}
