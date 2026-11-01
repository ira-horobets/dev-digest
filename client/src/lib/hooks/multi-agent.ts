/* hooks/multi-agent.ts — React Query hooks for multi-agent reviews:
   per-agent estimates, starting a run, and reading one run (polled while it runs). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  AgentEstimates,
  MultiAgentRun,
  MultiAgentRunStarted,
} from "@devdigest/shared";

export const multiAgentKey = (id: string | null | undefined) => ["multi-agent-run", id] as const;

/** Per-agent estimates and the server's concurrency cap. */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["multi-agent-estimates"],
    queryFn: () => api.get<AgentEstimates>("/multi-agent/estimates"),
  });
}

/** Start a multi-agent run: rows exist when it resolves, models are still running. */
export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<MultiAgentRunStarted>(`/pulls/${prId}/multi-agent-run`, { agent_ids: agentIds }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["multi-agent-latest", prId] });
    },
  });
}

/** One multi-agent run; polls every 4 s while its status is `running`. */
export function useMultiAgentRun(id: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentKey(id),
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${id}`),
    enabled: !!id,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 4000 : false),
  });
}

/** The PR's latest multi-agent run. A 404 means "none yet": no retry. */
export function useLatestMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-latest", prId],
    queryFn: () => api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
}
