/* Step 1 — pick the target (only GitHub Actions has a generator) and the repository. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField } from "@devdigest/ui";
import type { Repo } from "@devdigest/shared";
import { OptionCard, OptionGroup } from "@/components/option-card";
import { s } from "./styles";

export interface TargetStepProps {
  repos: Repo[];
  repo: string;
  onRepo: (fullName: string) => void;
  /** Non-null when the agent's provider is not supported by CI. */
  unsupportedProvider: string | null;
}

export function TargetStep({ repos, repo, onRepo, unsupportedProvider }: TargetStepProps) {
  const t = useTranslations("ci.exportWizard");
  const selectId = React.useId();
  return (
    <>
      <OptionGroup label={t("steps.target")}>
        <OptionCard
          title={t("targets.gha")}
          description={t("targets.ghaDesc")}
          tag={t("recommended")}
          selected
          onSelect={() => {}}
        />
      </OptionGroup>
      <FormField label={<label htmlFor={selectId}>{t("repoLabel")}</label>} hint={t("repoHint")} required>
        <select id={selectId} value={repo} onChange={(e) => onRepo(e.target.value)} style={s.select}>
          <option value="">{t("repoPlaceholder")}</option>
          {repos.map((r) => (
            <option key={r.id} value={r.full_name}>
              {r.full_name}
            </option>
          ))}
        </select>
        {repos.length === 0 && <div style={s.note}>{t("noRepos")}</div>}
      </FormField>
      {unsupportedProvider && (
        <div role="alert" style={s.alert}>
          {t("providerUnsupported", { provider: unsupportedProvider })}
        </div>
      )}
    </>
  );
}
