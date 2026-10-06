"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  repoFullName: string | null;
  prBody: string | null | undefined;
}

export function OverviewTab({ prId, repoFullName, prBody }: OverviewTabProps) {
  const t = useTranslations("intent");
  return (
    <>
      <section>
        <SectionLabel icon="FileText">{t("brief")}</SectionLabel>
        <div style={s.briefGrid}>
          <IntentCard prId={prId} repoFullName={repoFullName} />
        </div>
      </section>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
