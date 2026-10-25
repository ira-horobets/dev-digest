import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval (Eval Dashboard). Thin route entry — the view, its rows, the
   run-all modal and styles are colocated under _components/EvalDashboardView. */
export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
