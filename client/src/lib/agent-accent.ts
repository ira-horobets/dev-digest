/* agent-accent — a stable colour and icon per agent for the multi-agent screens.
   Agents carry no colour or icon field, so it is derived from the name (first
   matching keyword wins) and falls back to a palette slot picked from the id.
   Colours are CSS variables only. */
import type { IconName } from "@devdigest/ui";

export type AgentAccent = {
  /** Border, checkbox and icon colour. */
  color: string;
  /** Tinted background for the icon tile and a selected card. */
  bg: string;
  icon: IconName;
};

const RED = { color: "var(--crit)", bg: "var(--crit-bg)" };
const AMBER = { color: "var(--warn)", bg: "var(--warn-bg)" };
const BLUE = { color: "var(--accent)", bg: "var(--accent-bg)" };
const GREEN = { color: "var(--ok)", bg: "var(--ok-bg)" };

const RULES: { match: RegExp; accent: AgentAccent }[] = [
  { match: /secur/i, accent: { ...RED, icon: "Shield" } },
  { match: /perf/i, accent: { ...AMBER, icon: "Zap" } },
  { match: /mentor|junior/i, accent: { ...BLUE, icon: "Lightbulb" } },
  { match: /customer|client|\bux\b|\bdx\b/i, accent: { ...BLUE, icon: "Users" } },
  { match: /architect/i, accent: { ...GREEN, icon: "Layers" } },
  { match: /test/i, accent: { ...GREEN, icon: "FlaskConical" } },
  { match: /api|contract/i, accent: { ...AMBER, icon: "Workflow" } },
  { match: /bug|general|correct/i, accent: { ...BLUE, icon: "Eye" } },
];

const PALETTE = [BLUE, GREEN, AMBER, RED];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function agentAccent(agent: { id: string; name: string }): AgentAccent {
  const rule = RULES.find((r) => r.match.test(agent.name));
  if (rule) return rule.accent;
  return { ...PALETTE[hash(agent.id) % PALETTE.length]!, icon: "Cpu" };
}
