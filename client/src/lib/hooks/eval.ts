/* hooks/eval.ts — React Query hooks for the Eval Pipeline (L06): cases,
   runs, the dashboard, one agent's detail and the two-run compare.

   A run executes in the background on the server; `useEvalRun` polls only
   while `status === "running"` and invalidates the read caches when it
   settles. Every GET here reads stored rows — opening a surface never
   spends a model call. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch } from "../api";
import type {
  EvalAgentDetail,
  EvalCase,
  EvalCaseFromFindingResult,
  EvalCaseInput,
  EvalCompare,
  EvalDashboard,
  EvalRunAllResult,
  EvalRunRecord,
  EvalRunResult,
} from "@devdigest/shared";

export const evalKeys = {
  cases: (agentId: string | null | undefined) => ["eval-cases", agentId] as const,
  case: (caseId: string | null | undefined) => ["eval-case", caseId] as const,
  runs: (agentId: string | null | undefined) => ["eval-runs", agentId] as const,
  run: (runId: string | null | undefined) => ["eval-run", runId] as const,
  dashboard: () => ["eval-dashboard"] as const,
  agentDetail: (agentId: string | null | undefined, days: number | "all") =>
    ["eval-agent-detail", agentId, days] as const,
  compare: (a: string | null | undefined, b: string | null | undefined) => ["eval-compare", a, b] as const,
};

/** Poll cadence while a run is in flight. */
const RUN_POLL_MS = 3000;

// ---- Cases ------------------------------------------------------------------

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval/cases`),
    enabled: !!agentId,
  });
}

export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.case(caseId),
    queryFn: () => api.get<EvalCase>(`/eval/cases/${caseId}`),
    enabled: !!caseId,
  });
}

function invalidateAgentReads(qc: ReturnType<typeof useQueryClient>, agentId: string) {
  qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
  qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
  qc.invalidateQueries({ queryKey: ["eval-agent-detail", agentId] });
  qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
}

/** POST /findings/:id/eval-case — one click on a triaged finding. */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCaseFromFindingResult>(`/findings/${findingId}/eval-case`),
    onSuccess: (result) => invalidateAgentReads(qc, result.case.owner_id),
  });
}

/** POST /agents/:id/eval/cases — the hand-authored path. */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: EvalCaseInput }) =>
      api.post<EvalCase>(`/agents/${agentId}/eval/cases`, input),
    onSuccess: (data) => invalidateAgentReads(qc, data.owner_id),
  });
}

/** PATCH /eval/cases/:id — re-validated server-side; never touches stored runs. */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EvalCaseInput> }) =>
      api.patch<EvalCase>(`/eval/cases/${id}`, patch),
    onSuccess: (data) => {
      qc.setQueryData(evalKeys.case(data.id), data);
      invalidateAgentReads(qc, data.owner_id);
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; agentId: string }) => api.del<{ ok: boolean }>(`/eval/cases/${id}`),
    onSuccess: (_d, { id, agentId }) => {
      qc.removeQueries({ queryKey: evalKeys.case(id) });
      invalidateAgentReads(qc, agentId);
    },
  });
}

// ---- Runs -------------------------------------------------------------------

/** POST /agents/:id/eval/runs — suite run, or a `caseIds` subset. */
export function useStartEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, caseIds }: { agentId: string; caseIds?: string[] }) =>
      apiFetch<EvalRunResult>(`/agents/${agentId}/eval/runs`, {
        method: "POST",
        body: JSON.stringify(caseIds && caseIds.length > 0 ? { case_ids: caseIds } : {}),
      }),
    onSuccess: (_r, { agentId }) => invalidateAgentReads(qc, agentId),
  });
}

/** GET /eval/runs/:id — polls while running, then refreshes the read caches. */
export function useEvalRun(runId: string | null | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: evalKeys.run(runId),
    queryFn: async () => {
      const run = await api.get<EvalRunRecord>(`/eval/runs/${runId}`);
      if (run.status !== "running") invalidateAgentReads(qc, run.owner_id);
      return run;
    },
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? RUN_POLL_MS : false),
  });
}

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: () => api.get<EvalRunRecord[]>(`/agents/${agentId}/eval/runs`),
    enabled: !!agentId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? RUN_POLL_MS : false,
  });
}

/** POST /eval/runs/all — every enabled agent with cases; per-agent result. */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>(`/eval/runs/all`, { confirm: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
      qc.invalidateQueries({ queryKey: ["eval-agent-detail"] });
      qc.invalidateQueries({ queryKey: ["eval-runs"] });
    },
  });
}

// ---- Reads ------------------------------------------------------------------

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard(),
    queryFn: () => api.get<EvalDashboard>(`/eval/dashboard`),
    refetchInterval: (query) =>
      (query.state.data?.recent_runs ?? []).some((r) => r.status === "running") ? RUN_POLL_MS : false,
  });
}

export function useEvalAgentDetail(agentId: string | null | undefined, days: number | "all" = 30) {
  return useQuery({
    queryKey: evalKeys.agentDetail(agentId, days),
    queryFn: () => api.get<EvalAgentDetail>(`/eval/agents/${agentId}?days=${days}`),
    enabled: !!agentId,
    refetchInterval: (query) =>
      (query.state.data?.runs ?? []).some((r) => r.status === "running") ? RUN_POLL_MS : false,
  });
}

export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () => api.get<EvalCompare>(`/eval/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b && a !== b,
  });
}
