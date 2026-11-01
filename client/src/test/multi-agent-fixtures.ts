import type { AgentColumn, Conflict, MultiAgentRun } from "@devdigest/shared";

export const column = (n: number, over: Partial<AgentColumn> = {}): AgentColumn => ({
  run_id: `run${n}`,
  agent_id: `a${n}`,
  agent_name: `Agent ${n}`,
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  verdict: "request_changes",
  score: 70 + n,
  summary: `Summary ${n}`,
  duration_ms: 8000 * n,
  cost_usd: 0.01 * n,
  findings: [
    { id: `f${n}`, severity: "CRITICAL", category: "security", title: `Finding ${n}`, file: "src/a.ts", start_line: 10, kind: "finding" },
  ],
  ...over,
});

export const take = (n: number, verdict: Conflict["takes"][number]["verdict"], note = ""): Conflict["takes"][number] => ({
  agent_id: `a${n}`,
  run_id: `run${n}`,
  persona: `Agent ${n}`,
  verdict,
  note,
});

export const multiRun = (columns: AgentColumn[], conflicts: Conflict[] = [], over: Partial<MultiAgentRun> = {}): MultiAgentRun => ({
  id: "m1",
  pr_id: "pr1",
  pr_number: 42,
  ran_at: "2026-10-31T00:00:00.000Z",
  status: "done",
  agent_count: columns.length,
  total_duration_ms: 16000,
  total_cost_usd: 0.03,
  columns,
  conflicts,
  ...over,
});
