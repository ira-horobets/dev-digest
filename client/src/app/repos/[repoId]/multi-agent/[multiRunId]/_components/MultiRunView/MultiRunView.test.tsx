import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import runs from "../../../../../../../../messages/en/runs.json";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { column, multiRun, take } from "@/test/multi-agent-fixtures";
import type { MultiAgentRun } from "@devdigest/shared";

const replace = vi.fn();
const state: { view: string | null; run: MultiAgentRun } = { view: null, run: multiRun([]) };
const sources: string[] = [];
class FakeEventSource {
  onmessage = null;
  onerror = null;
  constructor(url: string) {
    sources.push(url);
  }
  addEventListener() {}
  close() {}
}
vi.stubGlobal("EventSource", FakeEventSource);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => ({ get: (k: string) => (k === "view" ? state.view : null) }),
  usePathname: () => "/repos/r1/multi-agent/m1",
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/api" } }),
  useRepoNotFound: () => false,
}));
vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({ data: [{ number: 42, title: "Add retry budget" }] }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  multiAgentKey: (id: string) => ["multi-agent-run", id],
  useMultiAgentRun: () => ({ data: state.run, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (ids: string[]) => {
    ids.forEach((id) => sources.push(id));
    return { events: [], running: false };
  },
  useRunFindings: () => ({ data: { findings: [] }, isLoading: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/run-trace-drawer", () => ({
  default: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div role="dialog" aria-label="trace">
      trace of {runId}
      <button onClick={onClose}>close</button>
    </div>
  ),
  eventsToLog: () => [],
}));

import { MultiRunView } from "./MultiRunView";

beforeEach(() => {
  replace.mockReset();
  sources.length = 0;
  state.view = null;
  state.run = multiRun(
    [column(1), column(2), column(3, { status: "running", score: null, duration_ms: null, cost_usd: null, findings: [] })],
    [{ file: "src/a.ts", line: 10, end_line: 10, title: "T", conflict: true, takes: [take(1, "CRITICAL", "n"), take(2, "ignored"), take(3, "no_result")] }],
    { status: "running" },
  );
});
afterEach(cleanup);

const renderView = () =>
  render(
    <QueryWrapper>
      <MultiRunView repoId="r1" multiRunId="m1" />
    </QueryWrapper>,
  );

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
function QueryWrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ runs, prReview, shell }}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe("MultiRunView", () => {
  it("shows the header and columns by default, and streams only the running column (reload rebuild)", () => {
    renderView();
    expect(screen.getByRole("link", { name: "Configure run" })).toHaveAttribute("href", "/repos/r1/multi-agent?pr=42");
    expect(screen.getByRole("heading", { name: "Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByText(/2\/3 done/)).toBeInTheDocument(); // progress while running
    expect(screen.getByText("Add retry budget")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("… total")).toBeInTheDocument(); // no total duration while running
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("region")).toHaveLength(3 + 1); // three columns + the disagreements block
    expect(sources).toEqual(["run3"]);
  });

  it("an invalid ?view= falls back to columns; ?view=tabs shows tabs; the toggle writes the URL", async () => {
    const user = userEvent.setup();
    state.view = "bogus";
    renderView();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tabs" }));
    expect(replace).toHaveBeenCalledWith("/repos/r1/multi-agent/m1?view=tabs");
    cleanup();
    state.view = "tabs";
    renderView();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabs" })).toHaveAttribute("aria-pressed", "true");
  });

  it("View trace opens the trace drawer for that column's run", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getAllByRole("button", { name: "View trace" })[1]!);
    expect(screen.getByRole("dialog", { name: "trace" })).toHaveTextContent("trace of run2");
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
