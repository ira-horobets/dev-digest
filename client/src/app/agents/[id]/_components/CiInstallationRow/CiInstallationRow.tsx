/* CiInstallationRow — one installation: repo, target, last export outcome, age,
   PR state link, workflow version; expands to its install/update history. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { CiInstallation } from "@devdigest/shared";
import { CiStatusBadge } from "@/components/ci-status-badge";
import { relativeTime } from "@/lib/relative-time";
import { s } from "./styles";

export function CiInstallationRow({ installation: i }: { installation: CiInstallation }) {
  const t = useTranslations("ci.tab");
  const [open, setOpen] = React.useState(false);
  const historyId = React.useId();
  return (
    <li style={s.row}>
      <div style={s.line}>
        <code style={s.repo}>{i.repo}</code>
        <span style={s.muted}>{t("githubActions")}</span>
        {i.last_export_outcome ? (
          <CiStatusBadge kind={i.last_export_outcome} label={t(`outcome.${i.last_export_outcome}`)} />
        ) : (
          <span style={s.muted}>{t("neverExported")}</span>
        )}
        <span style={s.muted}>{relativeTime(i.last_export_at ?? i.installed_at)}</span>
        {i.pr_url && i.pr_state ? (
          <a href={i.pr_url} target="_blank" rel="noreferrer" style={s.link}>
            {t(`prState.${i.pr_state}`)}
          </a>
        ) : (
          <span style={s.muted}>{t("noPr")}</span>
        )}
        {i.pr_state_stale && (
          <Badge color="var(--warn)" bg="var(--warn-bg)">
            {t("couldNotRefresh")}
          </Badge>
        )}
        {i.workflow_version && <span style={s.mono}>{t("version", { version: i.workflow_version })}</span>}
        {i.out_of_date && (
          <Badge color="var(--warn)" bg="var(--warn-bg)">
            {t("outOfDate")}
          </Badge>
        )}
        <span style={s.spacer} />
        <Button size="sm" kind="ghost" aria-expanded={open} aria-controls={historyId} onClick={() => setOpen(!open)}>
          {open ? t("hideHistory") : t("history")}
        </Button>
      </div>
      {open && (
        <ul id={historyId} aria-label={t("history")} style={s.history}>
          {i.events.length === 0 && <li style={s.muted}>{t("historyEmpty")}</li>}
          {i.events.map((e) => (
            <li key={e.id} style={s.event}>
              <span style={s.muted}>{relativeTime(e.at)}</span>
              <span>{t(`historyAction.${e.action}`)}</span>
              <span style={s.mono}>{e.template_version ?? "—"}</span>
              <CiStatusBadge kind={e.outcome} label={t(`outcome.${e.outcome}`)} />
              {e.pr_url && (
                <a href={e.pr_url} target="_blank" rel="noreferrer" style={s.link}>
                  PR
                </a>
              )}
              {e.error && <span style={s.error}>{e.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
