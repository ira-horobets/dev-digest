"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, LineChart } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";
import { formatPct, formatRanAt } from "../../../../../../lib/eval-format";
import { s } from "./styles";

const SERIES = [
  { key: "recall", labelKey: "metrics.recall", color: "var(--accent)" },
  { key: "precision", labelKey: "metrics.precision", color: "var(--ok)" },
  { key: "citation_accuracy", labelKey: "metrics.citation", color: "var(--warn)" },
] as const;

/** The three-metric trend over completed suite runs, with a hidden table twin. */
export function TrendChart({ trend }: { trend: EvalTrendPoint[] }) {
  const t = useTranslations("eval");
  const na = t("notApplicable");
  const values = trend.flatMap((p) => [p.recall, p.precision, p.citation_accuracy]).filter((v): v is number => v != null);
  const yMin = values.length ? Math.max(0, Math.floor((Math.min(...values) - 0.05) * 10) / 10) : 0.6;

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <span style={s.sectionLabel}>
          <Icon.TrendingUp size={14} />
          {t("detail.metricTrend")}
        </span>
        <div style={s.legend}>
          {SERIES.map((sr) => (
            <span key={sr.key} style={s.legendItem(sr.color)}>
              <span style={s.legendSwatch(sr.color)} />
              {t(sr.labelKey)}
            </span>
          ))}
        </div>
      </div>
      {trend.length < 2 ? (
        <p style={s.hint}>{t("detail.trendHint")}</p>
      ) : (
        <>
          <LineChart
            w={1200}
            h={260}
            yMin={yMin}
            yMax={1}
            series={SERIES.map((sr) => ({
              name: t(sr.labelKey),
              color: sr.color,
              data: trend.map((p) => p[sr.key] ?? 0),
            }))}
          />
          <table style={s.srOnly}>
            <caption>{t("detail.metricTrend")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("detail.table.ranAt")}</th>
                {SERIES.map((sr) => (
                  <th key={sr.key} scope="col">{t(sr.labelKey)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trend.map((p) => (
                <tr key={p.run_id}>
                  <td>{formatRanAt(p.ran_at)}</td>
                  <td>{formatPct(p.recall, na)}</td>
                  <td>{formatPct(p.precision, na)}</td>
                  <td>{formatPct(p.citation_accuracy, na)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
