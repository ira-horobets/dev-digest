"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@devdigest/ui";
import { useRepoIntelStatus, useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { s } from "./styles";

/**
 * Shown when the tour was built without a usable code index. "Rebuild index"
 * starts a resync (a 202 that finishes in the background): remember the index
 * timestamp at click time, poll it, and refetch the tour once it advances.
 */
export function LimitedBanner({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const qc = useQueryClient();
  const resync = useResyncRepoIntel(repoId);
  const [rebuildFrom, setRebuildFrom] = React.useState<string | null>(null);
  const { data: intel } = useRepoIntelStatus(repoId, rebuildFrom !== null);

  React.useEffect(() => {
    if (rebuildFrom === null || !intel || intel.updatedAt === rebuildFrom) return;
    setRebuildFrom(null);
    void qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
  }, [rebuildFrom, intel, repoId, qc]);

  const start = () => {
    setRebuildFrom(intel?.updatedAt ?? "");
    resync.mutate(undefined, { onError: () => setRebuildFrom(null) });
  };
  const rebuilding = resync.isPending || rebuildFrom !== null;

  return (
    <div style={s.banner} role="note">
      <div style={s.text}>
        <div style={s.title}>{t("limited.title")}</div>
        <div style={s.body}>{t("limited.body")}</div>
      </div>
      <Button size="sm" icon="RefreshCw" loading={rebuilding} disabled={rebuilding} onClick={start}>
        {rebuilding ? t("limited.rebuilding") : t("limited.rebuild")}
      </Button>
    </div>
  );
}
