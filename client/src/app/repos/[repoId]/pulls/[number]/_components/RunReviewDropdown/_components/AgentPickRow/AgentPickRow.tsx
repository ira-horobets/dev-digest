/* AgentPickRow — one agent in the Run Review picker: checkbox labelled with the
   name, its model, a "disabled" marker and the estimate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { AgentEstimate } from "@devdigest/shared";
import { EstimateLabel } from "@/components/estimate-label";
import { s } from "./styles";

export function AgentPickRow({
  name,
  model,
  enabled,
  checked,
  estimate,
  onToggle,
}: {
  name: string;
  model: string;
  enabled: boolean;
  checked: boolean;
  estimate: AgentEstimate | undefined;
  onToggle: () => void;
}) {
  const t = useTranslations("prReview");
  return (
    <div style={s.row}>
      <Checkbox
        checked={checked}
        onChange={onToggle}
        label={
          <span style={s.label}>
            <span style={s.name}>{name}</span>
            <span style={s.meta}>
              <span className="mono">{model}</span>
              {!enabled && <span style={s.disabled}>{t("runReview.disabled")}</span>}
              <EstimateLabel durationMs={estimate?.duration_ms} costUsd={estimate?.cost_usd} />
            </span>
          </span>
        }
      />
    </div>
  );
}
