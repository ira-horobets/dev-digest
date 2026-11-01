/* Step 4 — open a PR (default) or download a zip. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { OptionCard, OptionGroup } from "@/components/option-card";
import { DOCS_URL } from "../../constants";
import { s } from "./styles";

export type InstallMode = "pr" | "zip";

export interface InstallResult {
  prUrl: string | null;
  error: { message: string; missingPermission: string | null } | null;
  zipped: boolean;
}

export interface InstallStepProps {
  mode: InstallMode;
  onMode: (m: InstallMode) => void;
  repo: string;
  fileCount: number;
  studioToken: boolean;
  result: InstallResult | null;
}

export function InstallStep({ mode, onMode, repo, fileCount, studioToken, result }: InstallStepProps) {
  const t = useTranslations("ci.exportWizard");
  return (
    <>
      <OptionGroup label={t("steps.install")}>
        <OptionCard
          title={t("installCardTitle")}
          description={t("installCardBody", { repo, count: fileCount })}
          tag={t("recommended")}
          selected={mode === "pr"}
          onSelect={() => onMode("pr")}
          disabled={!studioToken}
          disabledReason={!studioToken ? t("noTokenReason") : undefined}
        />
        <OptionCard
          title={t("zipTitle")}
          description={t("zipBody")}
          selected={mode === "zip"}
          onSelect={() => onMode("zip")}
        />
      </OptionGroup>
      <a href={DOCS_URL} target="_blank" rel="noreferrer" style={s.link}>
        {t("docsLink")}
      </a>
      {result?.prUrl && (
        <div role="status" style={s.ok}>
          {t("prOpened")}:{" "}
          <a href={result.prUrl} target="_blank" rel="noreferrer">
            {t("prLink")}
          </a>
        </div>
      )}
      {result?.zipped && (
        <div role="status" style={s.ok}>
          {t("zipDone")}
        </div>
      )}
      {result?.error && (
        <div role="alert" style={s.error}>
          <strong>{t("installFailed")}</strong>
          <div>{result.error.message}</div>
          {result.error.missingPermission && (
            <div>{t("missingPermission", { permission: result.error.missingPermission })}</div>
          )}
        </div>
      )}
    </>
  );
}
