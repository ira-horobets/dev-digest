/* CiTab — CI deployment of one agent: installations, "Fail CI on", export and update. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, FormField, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useCiInstallations, useSetCiFailOn } from "@/lib/hooks/ci";
import { ExportCiWizard } from "@/app/agents/[id]/_components/ExportCiWizard";
import { CiInstallationRow } from "@/app/agents/[id]/_components/CiInstallationRow";
import { CiUpdateDialog } from "@/app/agents/[id]/_components/CiUpdateDialog";
import { FAIL_ON_VALUES } from "./constants";
import { outOfDate } from "./helpers";
import { s } from "./styles";

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci.tab");
  const { data, isLoading, isError, refetch } = useCiInstallations(agent.id);
  const setFailOn = useSetCiFailOn(agent.id);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [updateOpen, setUpdateOpen] = React.useState(false);
  const addRef = React.useRef<HTMLSpanElement>(null);

  const installations = data?.installations ?? [];
  const stale = outOfDate(installations);
  const activeCount = data?.active_count ?? 0;

  const closeWizard = () => {
    setWizardOpen(false);
    // Focus returns to the control that opened the modal (EC-26).
    requestAnimationFrame(() => addRef.current?.querySelector("button")?.focus());
  };

  const failOnOptions = FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`failOnOptions.${v}`) }));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h2 style={s.heading}>{t("heading")}</h2>
          <p style={s.sub}>{t("subtitle")}</p>
        </div>
        <span style={s.spacer} />
        {data && (
          <Badge
            color={activeCount > 0 ? "var(--ok)" : "var(--text-muted)"}
            bg={activeCount > 0 ? "var(--ok-bg)" : "var(--bg-hover)"}
          >
            {activeCount > 0 ? t("activeCount", { n: activeCount }) : t("notActive")}
          </Badge>
        )}
        <Button kind="secondary" size="sm" disabled={stale.length === 0} onClick={() => setUpdateOpen(true)}>
          {t("updateCi")}
        </Button>
        <span ref={addRef}>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
            {t("addToCi")}
          </Button>
        </span>
      </div>

      <div style={s.failOn}>
        <FormField label={t("failOn")} hint={t("failOnHint")}>
          <SelectInput value={agent.ci_fail_on} onChange={(v) => setFailOn.mutate(v as CiFailOn)} options={failOnOptions} />
        </FormField>
      </div>

      {isLoading ? (
        <Skeleton height={60} />
      ) : isError ? (
        <ErrorState title={t("loadError")} onRetry={() => refetch()} />
      ) : installations.length === 0 ? (
        <EmptyState icon="Workflow" title={t("empty")} body={t("emptyBody")} cta={t("addToCi")} onCta={() => setWizardOpen(true)} />
      ) : (
        <ul style={s.list}>
          {installations.map((i) => (
            <CiInstallationRow key={i.id} installation={i} />
          ))}
          <li style={{ listStyle: "none" }}>
            <button type="button" style={s.addRow} onClick={() => setWizardOpen(true)}>
              + {t("addRepository")}
            </button>
          </li>
        </ul>
      )}

      {wizardOpen && <ExportCiWizard agent={agent} onClose={closeWizard} />}
      {updateOpen && <CiUpdateDialog agentId={agent.id} installations={stale} onClose={() => setUpdateOpen(false)} />}
    </div>
  );
}
