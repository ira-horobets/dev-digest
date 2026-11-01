/* ExportCiWizard — "Export to CI": Target → Preview → Configure → Install.
   All wizard state lives here and is dropped when the modal closes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { Agent, CiPostAs, CiTrigger } from "@devdigest/shared";
import { Stepper } from "@/components/stepper";
import { ApiError } from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import { useRepos } from "@/lib/hooks/core";
import { useCiPreview, useCiSecrets, useExportCi } from "@/lib/hooks/ci";
import {
  DEFAULT_POST_AS,
  DEFAULT_TRIGGERS,
  MODAL_WIDTH,
  STEP_KEYS,
  SUPPORTED_PROVIDER,
  WORKFLOW_PATH,
  ZIP_FILENAME,
} from "./constants";
import { buildZip, isDirty, looksLikeSecret, validateYaml, withEditedWorkflow } from "./helpers";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep, type InstallMode, type InstallResult } from "./_components/InstallStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { s } from "./styles";

export function ExportCiWizard({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const t = useTranslations("ci.exportWizard");
  const { data: repos = [] } = useRepos();
  const exportCi = useExportCi();

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState("");
  const [triggers, setTriggers] = React.useState<CiTrigger[]>([...DEFAULT_TRIGGERS]);
  const [postAs, setPostAs] = React.useState<CiPostAs>(DEFAULT_POST_AS);
  const [edited, setEdited] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<InstallMode>("pr");
  const [confirmOverwrite, setConfirmOverwrite] = React.useState(false);
  const [pendingChange, setPendingChange] = React.useState<(() => void) | null>(null);
  const [result, setResult] = React.useState<InstallResult | null>(null);

  // Escape closes the dialog.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unsupportedProvider = agent.provider === SUPPORTED_PROVIDER ? null : agent.provider;
  const preview = useCiPreview(agent.id, { repo, post_as: postAs, triggers }, step >= 1);
  const secrets = useCiSecrets(agent.id, repo, step === 2);

  const generated = preview.data?.files.find((f) => f.path === WORKFLOW_PATH)?.contents;
  const workflowText = edited ?? generated ?? "";
  const yamlError = preview.data ? validateYaml(workflowText) : null;
  const keyWarning = looksLikeSecret(workflowText);
  const shownFiles = React.useMemo(
    () => withEditedWorkflow(preview.data?.files ?? [], WORKFLOW_PATH, edited),
    [preview.data, edited],
  );
  const studioToken = preview.data?.studio_token ?? true;
  const foreign = preview.data?.workflow_state === "foreign";

  /** A Configure change regenerates the workflow: confirm first when the user edited it (AC-13). */
  const requestChange = (apply: () => void) => {
    if (isDirty(edited, generated)) setPendingChange(() => apply);
    else apply();
  };
  const confirmRegenerate = () => {
    pendingChange?.();
    setEdited(null);
    setConfirmOverwrite(false);
    setPendingChange(null);
  };

  const canContinue =
    step === 0
      ? repo !== "" && !unsupportedProvider
      : step === 1
        ? !!preview.data
        : step === 2
          ? triggers.length > 0
          : false;
  const canInstall =
    !exportCi.isPending &&
    !!preview.data &&
    !yamlError &&
    (mode === "zip" || (studioToken && (!foreign || confirmOverwrite)));

  const install = async () => {
    setResult(null);
    if (mode === "zip") {
      downloadBlob(ZIP_FILENAME, buildZip(shownFiles), "application/zip");
      setResult({ prUrl: null, error: null, zipped: true });
      return;
    }
    try {
      const out = await exportCi.mutateAsync({
        agentId: agent.id,
        input: {
          repo,
          post_as: postAs,
          triggers,
          ...(isDirty(edited, generated) ? { workflow: edited ?? undefined } : {}),
          confirm_overwrite: confirmOverwrite,
          // The warning is shown next to the viewer; installing means the user accepted it.
          ...(keyWarning && isDirty(edited, generated) ? { confirm_secret_warning: true } : {}),
        },
      });
      setResult({ prUrl: out.pr_url, error: null, zipped: false });
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { missing_permission?: string | null } | undefined) : undefined;
      setResult({
        prUrl: null,
        zipped: false,
        error: {
          message: err instanceof Error ? err.message : "Unknown error",
          missingPermission: details?.missing_permission ?? null,
        },
      });
    }
  };

  const done = !!result?.prUrl;
  const labels = STEP_KEYS.map((k) => t(`steps.${k}`));

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("title")}
      subtitle={t("subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {step > 0 && !done && (
            <Button kind="ghost" onClick={() => setStep(step - 1)}>
              {t("back")}
            </Button>
          )}
          {done ? (
            <Button kind="primary" onClick={onClose}>
              {t("close")}
            </Button>
          ) : step < 3 ? (
            <Button kind="primary" onClick={() => setStep(step + 1)} disabled={!canContinue}>
              {t("continue")}
            </Button>
          ) : (
            <Button kind="primary" onClick={install} disabled={!canInstall}>
              {exportCi.isPending ? t("installing") : t("install")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.stepper}>
        <Stepper label={t("stepsLabel")} steps={labels} current={step} />
      </div>
      <div style={s.body}>
        {pendingChange && (
          <div role="alertdialog" aria-label={t("regenerateConfirm")} style={s.confirmBox}>
            <div>{t("regenerateConfirm")}</div>
            <div style={s.confirmActions}>
              <Button size="sm" kind="ghost" onClick={() => setPendingChange(null)}>
                {t("regenerateKeep")}
              </Button>
              <Button size="sm" kind="primary" onClick={confirmRegenerate}>
                {t("regenerateApply")}
              </Button>
            </div>
          </div>
        )}
        {step === 0 && (
          <TargetStep repos={repos} repo={repo} onRepo={setRepo} unsupportedProvider={unsupportedProvider} />
        )}
        {step === 1 && (
          <PreviewStep
            repo={repo}
            files={preview.data?.files}
            isLoading={preview.isLoading}
            isError={preview.isError}
            workflowText={workflowText}
            onWorkflowChange={setEdited}
            yamlError={yamlError}
            keyWarning={keyWarning}
            workflowState={preview.data?.workflow_state}
            memory={preview.data?.memory}
            repoPublic={preview.data?.repo_public}
            confirmOverwrite={confirmOverwrite}
            onConfirmOverwrite={setConfirmOverwrite}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={triggers}
            onTriggers={(next) => requestChange(() => setTriggers(next))}
            postAs={postAs}
            onPostAs={(next) => requestChange(() => setPostAs(next))}
            secrets={secrets.data?.secrets}
            secretsLoading={secrets.isLoading}
            runs={agent.stats.runs}
            avgCostUsd={agent.stats.avg_cost_usd}
          />
        )}
        {step === 3 && (
          <InstallStep
            mode={mode}
            onMode={setMode}
            repo={repo}
            fileCount={shownFiles.length}
            studioToken={studioToken}
            result={result}
          />
        )}
      </div>
    </Modal>
  );
}
