"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Tabs, TextInput, Textarea, Toggle, Icon } from "@devdigest/ui";
import type { Agent, EvalCase, EvalCaseInput, EvalCaseOutcome } from "@devdigest/shared";
import { useCreateEvalCase, useUpdateEvalCase } from "../../../../../../../lib/hooks/eval";
import { ApiError } from "../../../../../../../lib/api";
import { notify } from "../../../../../../../lib/toast";
import { formatCost, formatDuration } from "../../../../../../../lib/eval-format";
import { expectationSkeleton, expectationText, expectedCount, filesFromDiff, parseExpectation } from "./helpers";
import { s } from "./styles";

type InputTab = "diff" | "files" | "prMeta";

/**
 * Create / edit one eval case: the frozen input (diff, files, PR meta) on the
 * left, the expectation JSON (validated live against the shared schema) on
 * the right, and the case's last outcome. "Run on save" starts a single-case
 * run right after saving; "Run case" runs the stored case as-is.
 */
export function CaseEditorModal({
  agent,
  evalCase,
  outcome,
  runDisabled,
  onClose,
  onRun,
}: {
  agent: Agent;
  evalCase: EvalCase | null;
  outcome: EvalCaseOutcome | null;
  runDisabled: boolean;
  onClose: () => void;
  onRun: (caseId: string) => void;
}) {
  const t = useTranslations("eval");
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? "");
  const [files, setFiles] = React.useState((evalCase?.input_files ?? []).join("\n"));
  const [prTitle, setPrTitle] = React.useState(evalCase?.input_meta.title ?? "");
  const [prBody, setPrBody] = React.useState(evalCase?.input_meta.body ?? "");
  const [notes, setNotes] = React.useState(evalCase?.notes ?? "");
  const [expText, setExpText] = React.useState(evalCase ? expectationText(evalCase) : "");
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [runOnSave, setRunOnSave] = React.useState(!evalCase);
  const [error, setError] = React.useState<string | null>(null);

  const expectation = React.useMemo(() => parseExpectation(expText), [expText]);
  const jsonValid = expectation != null;
  const pending = create.isPending || update.isPending;

  const buildInput = (): EvalCaseInput | null => {
    if (!name.trim()) return (setError(t("caseEditor.nameRequired")), null);
    if (!diff.trim()) return (setError(t("caseEditor.diffRequired")), null);
    if (!expectation) return (setError(t("caseEditor.invalidJson")), null);
    const fileList = files
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
    return {
      name: name.trim(),
      notes: notes.trim() ? notes.trim() : null,
      input_diff: diff,
      input_files: fileList.length > 0 ? fileList : filesFromDiff(diff),
      input_meta: {
        pr_number: evalCase?.input_meta.pr_number ?? null,
        title: prTitle.trim() || name.trim(),
        body: prBody.trim() ? prBody : null,
      },
      expectation,
    };
  };

  const save = () => {
    setError(null);
    const input = buildInput();
    if (!input) return;
    const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : t("caseEditor.saveFailed"));
    const onSaved = (saved: EvalCase) => {
      notify.success(t("caseEditor.saved"));
      if (runOnSave && !runDisabled) onRun(saved.id);
      onClose();
    };
    if (evalCase) update.mutate({ id: evalCase.id, patch: input }, { onSuccess: onSaved, onError });
    else create.mutate({ agentId: agent.id, input }, { onSuccess: onSaved, onError });
  };

  const insertSkeleton = () => setExpText(expectationSkeleton(filesFromDiff(diff)[0] ?? "src/config.ts"));

  const title = evalCase ? t("caseEditor.editTitle", { name: evalCase.name }) : t("caseEditor.newTitle");

  return (
    <Modal
      width={1040}
      title={title}
      subtitle={t("caseEditor.subtitle", { agent: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <label style={s.footerToggle}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
            {t("caseEditor.runOnSave")}
          </label>
          {error && <span style={s.errorText}>{error}</span>}
          <div style={s.footerActions}>
            <Button kind="secondary" onClick={onClose} disabled={pending}>
              {t("caseEditor.cancel")}
            </Button>
            {evalCase && (
              <Button kind="secondary" icon="Play" disabled={runDisabled || pending} onClick={() => onRun(evalCase.id)}>
                {t("caseEditor.runCase")}
              </Button>
            )}
            <Button kind="primary" icon="Check" onClick={save} loading={pending}>
              {pending ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.editorBody}>
        <div style={s.editorCol}>
          <div style={s.field}>
            <label style={s.label} htmlFor="eval-case-name">
              {t("caseEditor.name")} <span style={s.required}>*</span>
            </label>
            <TextInput id="eval-case-name" value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} mono />
          </div>

          <div style={s.field}>
            <span style={s.label}>{t("caseEditor.input")}</span>
            <Tabs
              tabs={[
                { key: "diff", label: t("caseEditor.tabs.diff") },
                { key: "files", label: t("caseEditor.tabs.files") },
                { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
              ]}
              value={inputTab}
              onChange={(k) => setInputTab(k as InputTab)}
              pad="0"
            />
            {inputTab === "diff" && (
              <textarea
                aria-label={t("caseEditor.tabs.diff")}
                style={s.codeArea}
                value={diff}
                onChange={(e) => setDiff(e.target.value)}
                placeholder={t("caseEditor.diffPlaceholder")}
                spellCheck={false}
              />
            )}
            {inputTab === "files" && (
              <>
                <textarea
                  aria-label={t("caseEditor.tabs.files")}
                  style={{ ...s.codeArea, minHeight: 120 }}
                  value={files}
                  onChange={(e) => setFiles(e.target.value)}
                  placeholder={filesFromDiff(diff).join("\n") || "src/config.ts"}
                  spellCheck={false}
                />
                <span style={s.hint}>{t("caseEditor.filesHint")}</span>
              </>
            )}
            {inputTab === "prMeta" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={s.field}>
                  <label style={s.label} htmlFor="eval-case-pr-title">
                    {t("caseEditor.prTitle")}
                  </label>
                  <TextInput id="eval-case-pr-title" value={prTitle} onChange={setPrTitle} placeholder={t("caseEditor.prTitlePlaceholder")} />
                </div>
                <div style={s.field}>
                  <span style={s.label}>{t("caseEditor.prBody")}</span>
                  <Textarea value={prBody} onChange={setPrBody} rows={4} placeholder={t("caseEditor.prBodyPlaceholder")} />
                </div>
                <div style={s.field}>
                  <span style={s.label}>{t("caseEditor.notes")}</span>
                  <Textarea value={notes} onChange={setNotes} rows={2} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={s.editorColRight}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={s.label}>{t("caseEditor.expectedOutput")}</span>
            <span style={s.jsonBadge(jsonValid)}>
              {jsonValid ? <Icon.Check size={12} /> : <Icon.X size={12} />}
              {jsonValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </span>
            <div style={{ marginLeft: "auto" }}>
              <Button kind="secondary" size="sm" icon="Plus" onClick={insertSkeleton}>
                {t("caseEditor.skeleton")}
              </Button>
            </div>
          </div>
          <textarea
            aria-label={t("caseEditor.expectedOutput")}
            style={{ ...s.codeArea, minHeight: 340, flex: 1 }}
            value={expText}
            onChange={(e) => setExpText(e.target.value)}
            placeholder={expectationSkeleton()}
            spellCheck={false}
          />
          <span style={s.hint}>{t("caseEditor.expectationHint")}</span>
          <LastRun outcome={outcome} />
        </div>
      </div>
    </Modal>
  );
}

function LastRun({ outcome }: { outcome: EvalCaseOutcome | null }) {
  const t = useTranslations("eval");
  const na = t("notApplicable");
  if (!outcome) {
    return (
      <div style={s.lastRun("var(--border)", "var(--bg-elevated)")}>
        <Icon.Clock size={16} style={{ color: "var(--text-muted)" }} />
        {t("caseEditor.neverRun")}
      </div>
    );
  }
  if (outcome.status === "errored") {
    return (
      <div style={s.lastRun("var(--warn)", "var(--warn-bg)")}>
        <Icon.AlertTriangle size={16} style={{ color: "var(--warn)" }} />
        <strong>{t("caseEditor.lastRunErrored")}</strong> · {outcome.error_reason}
      </div>
    );
  }
  const summary = t("caseEditor.lastRunSummary", {
    expected: expectedCount({ type: outcome.expectation_type }),
    got: outcome.findings_matched,
    duration: formatDuration(outcome.duration_ms),
    cost: formatCost(outcome.cost_usd, na),
  });
  return outcome.pass ? (
    <div style={s.lastRun("var(--ok)", "var(--ok-bg, rgba(34,197,94,0.12))")}>
      <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
      <span>
        <strong>{t("caseEditor.lastRunPassed")}</strong> · {summary}
      </span>
    </div>
  ) : (
    <div style={s.lastRun("var(--crit)", "var(--crit-bg)")}>
      <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
      <span>
        <strong>{t("caseEditor.lastRunFailed")}</strong> · {summary}
      </span>
    </div>
  );
}
