/**
 * multi-agent — ports (ring 1). Plain types only. `routes.ts` assembles
 * `MultiAgentDeps` from the container; tests pass fakes.
 */

export interface PullInfo {
  id: string;
  number: number;
}

export interface AgentInfo {
  id: string;
  name: string;
}

export interface ChildFinding {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  kind: string | null;
}

/** One agent run of a multi-agent run, with its newest review and that review's findings. */
export interface ChildRun {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  review: { verdict: string | null; score: number | null; summary: string | null } | null;
  findings: ChildFinding[];
}

export interface ParentRow {
  id: string;
  prId: string;
  prNumber: number | null;
  /** ISO timestamp. */
  ranAt: string;
}

export interface MultiRunData {
  parent: ParentRow;
  children: ChildRun[];
}

export interface CreatedMultiRun {
  multiRunId: string;
  runs: { run_id: string; agent_id: string; agent_name: string }[];
}

export interface EstimateRow {
  agentId: string;
  durationMs: number | null;
  costUsd: number | null;
}

export interface MultiAgentRepositoryPort {
  /** undefined = the PR is not in the workspace. */
  getPull(workspaceId: string, prId: string): Promise<PullInfo | undefined>;
  /** The workspace's agents among `ids` (unknown ids are simply absent). */
  findAgents(workspaceId: string, ids: string[]): Promise<AgentInfo[]>;
  /** One transaction: the parent row and one `running` review run per agent. Rows come back in `agents` order. */
  createMultiRun(workspaceId: string, prId: string, agents: AgentInfo[]): Promise<CreatedMultiRun>;
  getMultiRun(workspaceId: string, id: string): Promise<MultiRunData | undefined>;
  latestForPull(workspaceId: string, prId: string): Promise<MultiRunData | undefined>;
  listAgentIds(workspaceId: string): Promise<string[]>;
  /** The newest `sample` done `review` runs of every agent that has any. */
  estimateRows(workspaceId: string, sample: number): Promise<EstimateRow[]>;
}

/** Structural slice of the reviews executor (reached through the container, never imported). */
export interface ReviewRunnerPort {
  executeQueued(
    workspaceId: string,
    prId: string,
    queued: { agentId: string; runId: string }[],
    opts: { concurrency: number; logger?: Logger },
  ): Promise<void>;
}

/** Pino-compatible logger, declared structurally. */
export interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
}

export interface MultiAgentDeps {
  repo: MultiAgentRepositoryPort;
  runner: ReviewRunnerPort;
  concurrency: number;
  lineTolerance: number;
}
