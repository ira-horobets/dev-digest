/* EstimateLabel — "~1m 20s · $0.012" for an estimated duration and cost, or
   "no estimate yet" when neither is known (never 0s / $0). `partial` appends a
   marker: some of the agents behind the total have no estimate.
   Purely presentational. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatCost } from "@/lib/format-cost";
import { formatDuration } from "@/lib/format-duration";
import { s } from "./styles";

export type EstimateLabelProps = {
  durationMs: number | null | undefined;
  costUsd: number | null | undefined;
  /** Some inputs of this total are unknown. */
  partial?: boolean;
};

export function EstimateLabel({ durationMs, costUsd, partial = false }: EstimateLabelProps) {
  const t = useTranslations("runs");
  if (durationMs == null && costUsd == null) {
    return (
      <span style={s.empty} data-testid="estimate-label">
        {t("estimate.none")}
      </span>
    );
  }
  return (
    <span className="tnum" style={s.value} data-testid="estimate-label">
      ~{formatDuration(durationMs)} · {formatCost(costUsd)}
      {partial && (
        <span style={s.partial} title={t("estimate.partialTitle")}>
          {" "}
          {t("estimate.partial")}
        </span>
      )}
    </span>
  );
}
