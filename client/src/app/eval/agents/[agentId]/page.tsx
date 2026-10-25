import { EvalAgentDetailView } from "./_components/EvalAgentDetailView";

/* Route: /eval/agents/:agentId — one agent's eval detail (metric tiles with
   deltas, trend, run history with two-run compare). */
export default function EvalAgentDetailPage() {
  return <EvalAgentDetailView />;
}
