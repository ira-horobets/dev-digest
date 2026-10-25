"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalMetricDeltas, EvalRun } from "@devdigest/shared";
import { formatPct } from "../../../../../../../lib/eval-format";
import { s } from "./styles";

const COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

/** The four KPI tiles from the latest completed suite run, with deltas vs the previous one. */
export function MetricTiles({ run, delta }: { run: EvalRun | null; delta: EvalMetricDeltas }) {
  const t = useTranslations("eval");
  const na = t("notApplicable");
  return (
    <div style={s.tiles}>
      <Tile label={t("metrics.recall")} value={formatPct(run?.recall, na)} color={COLORS.recall} delta={delta.recall} />
      <Tile label={t("metrics.precision")} value={formatPct(run?.precision, na)} color={COLORS.precision} delta={delta.precision} />
      <Tile
        label={t("metrics.citationAccuracy")}
        value={formatPct(run?.citation_accuracy, na)}
        color={COLORS.citation}
        delta={delta.citation_accuracy}
      />
      <Tile
        label={t("metrics.tracesPassed")}
        value={run ? `${run.traces_passed}/${run.traces_total}` : na}
        color="var(--text-primary)"
        delta={null}
      />
    </div>
  );
}

function Tile({ label, value, color, delta }: { label: string; value: string; color: string; delta: number | null }) {
  const pts = delta == null ? null : Math.round(delta * 100);
  const up = (pts ?? 0) > 0;
  const flat = pts === 0;
  const deltaColor = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  const DeltaIcon = flat ? Icon.Slash : up ? Icon.ArrowUp : Icon.ArrowDown;
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileValueRow}>
        <span className="tnum" style={s.tileValue(color)}>
          {value}
        </span>
        {pts != null && (
          <span style={s.tileDelta(deltaColor)}>
            <DeltaIcon size={12} />
            <span className="tnum">{Math.abs(pts)}pt</span>
          </span>
        )}
      </div>
    </div>
  );
}
