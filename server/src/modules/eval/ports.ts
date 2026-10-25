import type { LLMProvider, Provider, ReviewStrategy } from '@devdigest/shared';

/**
 * Local ports of the eval module. The module reads its OWN tables (and the
 * finding/PR/pr_files rows a case is frozen from) through `repository.ts`;
 * it only needs ports for the agent rows and the LLM resolver — both
 * satisfied structurally by `container.agentsRepo` / `container.llm` and
 * bound in `routes.ts`, so unit tests can hand in plain objects.
 */

/** The subset of an agent row this module needs. `AgentsRepository.getById`'s
 *  real row satisfies it structurally. */
export interface AgentRecord {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  version: number;
  enabled: boolean;
}

/** A config snapshot row — `agent_versions.config_json` carries the prompt. */
export interface AgentVersionRecord {
  version: number;
  configJson: unknown;
}

export interface AgentLookup {
  getById(workspaceId: string, id: string): Promise<AgentRecord | null | undefined>;
  list(workspaceId: string): Promise<AgentRecord[]>;
  getVersion(agentId: string, version: number): Promise<AgentVersionRecord | null | undefined>;
}

/** Resolves an agent's configured LLM provider (`container.llm`). */
export type LlmResolver = (provider: Provider) => Promise<LLMProvider>;

/** Pino-compatible subset — `console` satisfies it in tests. */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}
