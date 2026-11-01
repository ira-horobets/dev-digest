/* hooks/ci.ts — React Query hooks for Export to CI and the CI Runs page.
   Shared types are imported as types only (no runtime value from @devdigest/shared). */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useUpdateAgent } from "./agents";
import type {
  CiExport,
  CiFailOn,
  CiExportInputBody,
  CiInstallationsView,
  CiPreview,
  CiPreviewInputBody,
  CiRun,
  CiRunsQuery,
  CiRunsRefreshResult,
  CiSecretsView,
  CiUpdateResult,
} from "@devdigest/shared";

export type CiRunsFilters = Partial<Pick<CiRunsQuery, "range" | "agent_id" | "repo" | "status">>;

/** Files the wizard would write. Re-fetched whenever repo, post-as or triggers change. */
export function useCiPreview(agentId: string, input: CiPreviewInputBody & { repo: string }, enabled = true) {
  return useQuery({
    queryKey: ["ci-preview", agentId, input.repo, input.post_as, input.triggers],
    queryFn: () => api.post<CiPreview>(`/agents/${agentId}/ci/preview`, input),
    enabled: enabled && !!input.repo && (input.triggers?.length ?? 0) > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Names of the target repo's Actions secrets; fetched apart from Preview so it never delays it. */
export function useCiSecrets(agentId: string, repo: string, enabled = true) {
  return useQuery({
    queryKey: ["ci-secrets", agentId, repo],
    queryFn: () => api.get<CiSecretsView>(`/agents/${agentId}/ci/secrets?repo=${encodeURIComponent(repo)}`),
    enabled: enabled && !!repo,
    retry: false,
  });
}

/** Open (or update) the PR. The wizard shows the GitHub reason inline, so the global toast is off. */
export function useExportCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    meta: { silent: true },
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
    },
  });
}

export function useCiInstallations(agentId: string) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallationsView>(`/agents/${agentId}/ci/installations`),
  });
}

/** One call per installation; the caller loops. */
export function useUpdateCiInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, installationId }: { agentId: string; installationId: string }) =>
      api.post<CiUpdateResult>(`/agents/${agentId}/ci/installations/${installationId}/update`),
    meta: { silent: true },
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
    },
  });
}

/** Stored CI runs (never calls GitHub). */
export function useCiRuns(filters: CiRunsFilters) {
  return useQuery({
    queryKey: ["ci-runs", filters],
    queryFn: () => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
      const qs = q.toString();
      return api.get<{ runs: CiRun[] }>(`/ci/runs${qs ? `?${qs}` : ""}`);
    },
  });
}

/** Read new runs from GitHub; returns the in-progress rows and the rate-limit retry time. */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRunsRefreshResult>("/ci/runs/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

/** Auto-refresh period while the CI Runs page is visible. */
const AUTO_REFRESH_MS = 60_000;

/**
 * Calls `onTick` every 60 s while `enabled`, only when the browser tab is
 * visible and the GitHub rate-limit wait (`retryAt`) is over.
 */
export function useAutoRefreshCiRuns(onTick: () => void, opts: { enabled: boolean; retryAt: string | null }) {
  const latest = React.useRef({ onTick, retryAt: opts.retryAt });
  React.useEffect(() => {
    latest.current = { onTick, retryAt: opts.retryAt };
  });
  React.useEffect(() => {
    if (!opts.enabled) return;
    const id = setInterval(() => {
      const { retryAt, onTick: tick } = latest.current;
      const blocked = !!retryAt && Date.parse(retryAt) > Date.now();
      if (document.visibilityState === "visible" && !blocked) tick();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [opts.enabled]);
}

/** Save the agent's "Fail CI on" and mark the installations for a re-check (their hash changes). */
export function useSetCiFailOn(agentId: string) {
  const qc = useQueryClient();
  const update = useUpdateAgent();
  return {
    isPending: update.isPending,
    mutate: (ciFailOn: CiFailOn) =>
      update.mutate(
        { id: agentId, patch: { ci_fail_on: ciFailOn } },
        { onSuccess: () => qc.invalidateQueries({ queryKey: ["ci-installations", agentId] }) },
      ),
  };
}
