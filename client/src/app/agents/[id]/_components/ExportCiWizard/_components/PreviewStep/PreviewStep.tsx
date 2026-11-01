/* Step 2 — the files that will be written; only the workflow is editable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Skeleton } from "@devdigest/ui";
import type { CiFile, CiWorkflowState } from "@devdigest/shared";
import { FileViewer } from "@/components/file-viewer";
import { s } from "./styles";
import { WORKFLOW_PATH } from "../../constants";

export interface PreviewStepProps {
  repo: string;
  files: CiFile[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Current workflow text (edited or generated). */
  workflowText: string;
  onWorkflowChange: (next: string) => void;
  yamlError: string | null;
  keyWarning: boolean;
  workflowState: CiWorkflowState | undefined;
  memory: { included: number; total: number; dropped?: number } | undefined;
  /** True when the target repo is public. */
  repoPublic: boolean | null | undefined;
  confirmOverwrite: boolean;
  onConfirmOverwrite: (v: boolean) => void;
}

export function PreviewStep(p: PreviewStepProps) {
  const t = useTranslations("ci.exportWizard");
  if (p.isLoading) {
    return (
      <div aria-busy="true" aria-label={t("generating")} style={s.list}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (p.isError || !p.files) {
    return (
      <div role="alert" style={s.error}>
        {t("previewError")}
      </div>
    );
  }
  const foreign = p.workflowState === "foreign";
  return (
    <>
      <h3 style={s.heading}>{t("filesToCreate")}</h3>
      {p.memory && <div style={s.note}>{t("memoryLine", { included: p.memory.included, total: p.memory.total })}</div>}
      {p.memory && (p.memory.dropped ?? 0) > 0 && (
        <div role="status" style={s.note}>
          {t("memoryDropped", { dropped: p.memory.dropped ?? 0 })}
        </div>
      )}
      {p.repoPublic === true && p.memory && p.memory.included > 0 && (
        <div role="alert" style={s.overwriteBox}>
          {t("memoryPublic")}
        </div>
      )}
      <div style={s.list}>
        {p.files.map((f) =>
          f.path === WORKFLOW_PATH ? (
            <FileViewer
              key={f.path}
              path={f.path}
              contents={p.workflowText}
              editable
              onChange={p.onWorkflowChange}
              editableLabel={t("editable")}
              readOnlyLabel={t("readOnly")}
              extra={foreign ? <span style={s.overwrite}>{t("willOverwrite")}</span> : undefined}
              warning={
                p.yamlError ? t("yamlError", { error: p.yamlError }) : p.keyWarning ? t("keyWarning") : undefined
              }
            />
          ) : (
            <FileViewer
              key={f.path}
              path={f.path}
              contents={f.contents}
              editableLabel={t("editable")}
              readOnlyLabel={t("readOnly")}
              maxHeight={140}
            />
          ),
        )}
      </div>
      {foreign && (
        <div role="alert" style={s.overwriteBox}>
          <div>{t("overwriteWarning", { path: WORKFLOW_PATH, repo: p.repo })}</div>
          <Checkbox checked={p.confirmOverwrite} onChange={p.onConfirmOverwrite} label={t("overwriteConfirm")} />
        </div>
      )}
    </>
  );
}
