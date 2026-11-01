/* CiUpdateDialog — confirm "Update CI config": lists the out-of-date repos and
   warns that edits to the workflow in devdigest/ci are overwritten. Runs the
   updates one repo at a time and shows each outcome. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { CiInstallation } from "@devdigest/shared";
import { useUpdateCiInstallation } from "@/lib/hooks/ci";
import { s } from "./styles";

type Outcome = { ok: true } | { ok: false; error: string };

export function CiUpdateDialog({
  agentId,
  installations,
  onClose,
}: {
  agentId: string;
  installations: CiInstallation[];
  onClose: () => void;
}) {
  const t = useTranslations("ci.update");
  const update = useUpdateCiInstallation();
  // The list is fixed when the dialog opens; the installations query refreshes behind it.
  const [targets] = React.useState(installations);
  const [running, setRunning] = React.useState(false);
  const [finished, setFinished] = React.useState(false);
  const [outcomes, setOutcomes] = React.useState<Record<string, Outcome>>({});

  const confirm = async () => {
    setRunning(true);
    for (const inst of targets) {
      let outcome: Outcome;
      try {
        const res = await update.mutateAsync({ agentId, installationId: inst.id });
        outcome = res.error ? { ok: false, error: res.error } : { ok: true };
      } catch (err) {
        outcome = { ok: false, error: err instanceof Error ? err.message : "error" };
      }
      setOutcomes((o) => ({ ...o, [inst.id]: outcome }));
    }
    setRunning(false);
    setFinished(true);
  };

  return (
    <Modal
      width={520}
      title={t("title")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {finished ? (
            <Button kind="primary" onClick={onClose}>
              {t("done")}
            </Button>
          ) : (
            <Button kind="primary" onClick={confirm} disabled={running}>
              {running ? t("updating") : t("confirm", { n: targets.length })}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.body}>
        <p style={s.text}>{t("intro")}</p>
        <ul style={s.list}>
          {targets.map((i) => {
            const o = outcomes[i.id];
            return (
              <li key={i.id} style={s.item}>
                <code>{i.repo}</code>
                {o && <span style={o.ok ? s.ok : s.error}>{o.ok ? t("ok") : t("failed", { error: o.error })}</span>}
              </li>
            );
          })}
        </ul>
        <div role="alert" style={s.warning}>
          {t("warning")}
        </div>
      </div>
    </Modal>
  );
}
