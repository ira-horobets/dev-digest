"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { formatCost, formatRanAt, formatVersion } from "../../../../../../lib/eval-format";
import { MetricBar, METRIC_COLORS } from "../../../../_components/EvalDashboardView/MetricBar";
import { RunStatus } from "../../../../_components/EvalDashboardView/RecentRunsTable";
import { s } from "./styles";

const MAX_SELECTED = 2;

/** Run history with two-run selection driving the compare modal. */
export function RunHistoryTable({ runs, onCompare }: { runs: EvalRunRecord[]; onCompare: (a: string, b: string) => void }) {
  const t = useTranslations("eval");
  const na = t("notApplicable");
  const [selected, setSelected] = React.useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_SELECTED) return [cur[cur.length - 1]!, id];
      return [...cur, id];
    });

  return (
    <div>
      <div style={s.runsHead}>
        <span style={s.sectionLabel}>
          <Icon.History size={14} />
          {t("detail.recentRuns")}
        </span>
        {selected.length > 0 && <span style={s.selected}>{t("detail.selected", { count: selected.length })}</span>}
        <div style={{ marginLeft: "auto" }}>
          <Button
            kind="primary"
            size="sm"
            icon="GitBranch"
            disabled={selected.length !== MAX_SELECTED}
            onClick={() => onCompare(selected[0]!, selected[1]!)}
            title={selected.length !== MAX_SELECTED ? t("detail.selectTwo") : undefined}
          >
            {t("detail.compare")}
          </Button>
        </div>
      </div>
      {runs.length === 0 ? (
        <EmptyState icon="History" title={t("detail.recentRuns")} body={t("detail.noRuns")} />
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th} scope="col"><span style={s.srOnly}>{t("detail.table.select")}</span></th>
                <th style={s.th} scope="col">{t("detail.table.ranAt")}</th>
                <th style={s.th} scope="col">{t("detail.table.version")}</th>
                <th style={s.th} scope="col">{t("detail.table.recall")}</th>
                <th style={s.th} scope="col">{t("detail.table.precision")}</th>
                <th style={s.th} scope="col">{t("detail.table.citation")}</th>
                <th style={s.th} scope="col">{t("detail.table.pass")}</th>
                <th style={s.th} scope="col">{t("detail.table.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const completed = r.status === "completed";
                const checked = selected.includes(r.id);
                return (
                  <tr key={r.id} style={checked ? s.rowSelected : undefined}>
                    <td style={s.td}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!completed}
                        onChange={() => toggle(r.id)}
                        aria-label={`${t("detail.table.select")} ${formatVersion(r.agent_version)} ${formatRanAt(r.started_at)}`}
                      />
                    </td>
                    <td style={{ ...s.td, ...s.mono }}>{formatRanAt(r.started_at)}</td>
                    <td style={{ ...s.td, ...s.version }}>{formatVersion(r.agent_version)}</td>
                    {completed ? (
                      <>
                        <td style={s.td}><MetricBar value={r.metrics?.recall} color={METRIC_COLORS.recall} naLabel={na} /></td>
                        <td style={s.td}><MetricBar value={r.metrics?.precision} color={METRIC_COLORS.precision} naLabel={na} /></td>
                        <td style={s.td}><MetricBar value={r.metrics?.citation_accuracy} color={METRIC_COLORS.citation} naLabel={na} /></td>
                        <td style={{ ...s.td, ...s.pass }} className="tnum">
                          {r.metrics ? `${r.metrics.traces_passed}/${r.metrics.traces_total}` : na}
                        </td>
                        <td style={{ ...s.td, ...s.mono }}>{formatCost(r.cost_usd, na)}</td>
                      </>
                    ) : (
                      <td style={s.td} colSpan={5}>
                        <RunStatus status={r.status} reason={r.error_reason} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
