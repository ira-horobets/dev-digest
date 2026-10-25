"use client";

import React from "react";
import { ProgressBar } from "@devdigest/ui";
import { formatPct, pctValue } from "../../../../lib/eval-format";
import { s } from "./styles";

export const METRIC_COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

/** A thin coloured bar + percent label for one run metric in a table cell. */
export function MetricBar({ value, color, naLabel }: { value: number | null | undefined; color: string; naLabel: string }) {
  return (
    <div style={s.barCell}>
      <div style={s.bar}>
        <ProgressBar value={pctValue(value)} color={color} height={6} />
      </div>
      <span className="tnum" style={s.barPct}>
        {formatPct(value, naLabel)}
      </span>
    </div>
  );
}
