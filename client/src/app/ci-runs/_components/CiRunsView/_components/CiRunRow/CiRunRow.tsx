/* CiRunRow — one CI run: repo, PR (studio link when imported), agent, verdict,
   findings, cost, duration, time, status, GitHub job. */
import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import { CiStatusBadge } from "@/components/ci-status-badge";
import { formatCost } from "@/lib/format-cost";
import { relativeTime } from "@/lib/relative-time";
import { STATUS_LABEL_KEY } from "../../constants";
import { formatDuration } from "../../helpers";
import { s } from "./styles";

export function CiRunRow({ run }: { run: CiRun }) {
  const t = useTranslations("ci.runs");
  const status = run.status;
  return (
    <tr>
      <td style={s.td} title={run.ran_at ?? undefined}>
        {relativeTime(run.ran_at)}
      </td>
      <td style={s.mono}>{run.repo ?? "—"}</td>
      <td style={s.td}>
        {run.pr_number == null ? (
          "—"
        ) : run.pr_link ? (
          <Link href={`/repos/${run.pr_link.repo_id}/pulls/${run.pr_link.number}`} style={s.link}>
            #{run.pr_number}
          </Link>
        ) : (
          <span>#{run.pr_number}</span>
        )}
      </td>
      <td style={s.td}>{run.agent ?? "—"}</td>
      <td style={s.td}>{run.verdict ? t(`verdicts.${run.verdict}`) : "—"}</td>
      <td style={s.td} title={t("reportedTitle")}>
        {run.findings_count ?? "—"}
      </td>
      <td style={s.td} title={t("reportedTitle")}>
        {formatCost(run.cost_usd)}
      </td>
      <td style={s.td}>{formatDuration(run.duration_ms)}</td>
      <td style={s.td}>
        {status ? <CiStatusBadge kind={status} label={t(`status.${STATUS_LABEL_KEY[status]}`)} /> : "—"}
        {run.error && <div style={s.error}>{run.error}</div>}
      </td>
      <td style={s.td}>
        {run.github_url ? (
          <a href={run.github_url} target="_blank" rel="noreferrer" style={s.link}>
            {t("view")}
          </a>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
