"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Icon } from "@devdigest/ui";
import type { EvalAgentSummary, EvalRunAllResult } from "@devdigest/shared";
import { useRunAllEvals } from "../../../../lib/hooks/eval";
import { ApiError } from "../../../../lib/api";
import { s } from "./styles";

/** Confirmation (with the stated execution count) → per-agent result list. */
export function RunAllModal({ agents, onClose }: { agents: EvalAgentSummary[]; onClose: () => void }) {
  const t = useTranslations("eval");
  const runAll = useRunAllEvals();
  const [result, setResult] = React.useState<EvalRunAllResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const candidates = agents.filter((a) => a.enabled && a.cases_total > 0);
  const casesTotal = candidates.reduce((n, a) => n + a.cases_total, 0);

  const confirm = () =>
    runAll.mutate(undefined, {
      onSuccess: setResult,
      onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
    });

  return (
    <Modal
      width={560}
      title={result ? t("runAll.resultTitle") : t("runAll.title")}
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          {result ? (
            <Button kind="primary" onClick={onClose}>
              {t("runAll.close")}
            </Button>
          ) : (
            <>
              <Button kind="secondary" onClick={onClose} disabled={runAll.isPending}>
                {t("runAll.cancel")}
              </Button>
              <Button kind="primary" icon="Play" onClick={confirm} loading={runAll.isPending} disabled={candidates.length === 0}>
                {t("runAll.confirm")}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div style={s.modalBody}>
        {!result && candidates.length === 0 && <p>{t("runAll.noCandidates")}</p>}
        {!result && candidates.length > 0 && <p>{t("runAll.body", { agents: candidates.length, cases: casesTotal })}</p>}
        {error && <p style={{ color: "var(--crit)" }}>{error}</p>}
        {result &&
          result.started.map((row) => (
            <div key={row.agent_id} style={s.resultRow}>
              {row.run_id ? (
                <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
              ) : (
                <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
              )}
              <strong>{row.agent_name}</strong>
              <span>{row.run_id ? t("runAll.started") : `${t("runAll.refused")} · ${row.refused_reason ?? ""}`}</span>
            </div>
          ))}
      </div>
    </Modal>
  );
}
