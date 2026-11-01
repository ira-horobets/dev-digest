import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun, CiRunsRefreshResult } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/ci-runs",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [{ id: "ag1", name: "Security Reviewer" }] }) }));
vi.mock("@/lib/hooks/core", () => ({ useRepos: () => ({ data: [{ id: "r1", full_name: "acme/api" }] }) }));

const state = {
  runs: [] as CiRun[],
  refreshData: undefined as CiRunsRefreshResult | undefined,
  isPending: false,
};
const refreshMutate = vi.fn();
let lastFilters: unknown;
vi.mock("@/lib/hooks/ci", async () => ({
  // The real auto-refresh hook runs here: only the data hooks are faked.
  ...(await vi.importActual<typeof import("@/lib/hooks/ci")>("@/lib/hooks/ci")),
  useCiRuns: (f: unknown) => {
    lastFilters = f;
    return { data: { runs: state.runs }, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useRefreshCiRuns: () => ({ mutate: refreshMutate, data: state.refreshData, isPending: state.isPending }),
}));

import { CiRunsView } from "./CiRunsView";

const run = (over: Partial<CiRun> = {}): CiRun => ({
  id: "c1",
  ci_installation_id: "i1",
  agent_id: "ag1",
  repo: "acme/api",
  pr_number: 482,
  ran_at: new Date().toISOString(),
  status: "failed",
  verdict: "request_changes",
  findings_count: 2,
  blockers: 1,
  cost_usd: 0.0123,
  duration_ms: 65_000,
  github_url: "https://github.com/acme/api/actions/runs/1",
  github_run_id: 1,
  run_attempt: 1,
  source: "ci",
  agent: "Security Reviewer",
  pr_link: { repo_id: "r1", number: 482 },
  error: null,
  ...over,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <CiRunsView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.runs = [];
  state.refreshData = undefined;
  state.isPending = false;
  search = "";
  replace.mockReset();
  refreshMutate.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("CiRunsView", () => {
  it("empty state, default filter 'Last 7 days' and the auto-refresh toggle (AC-65, AC-69)", () => {
    renderView();
    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.getByText(/Once you export an agent to CI/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Time range" })).toHaveValue("7d");
    expect(lastFilters).toMatchObject({ range: "7d" });
    expect(screen.getByText("auto-refresh on")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("lists runs with every column, a studio link for imported PRs and a GitHub job link (AC-64, AC-67)", () => {
    state.runs = [run(), run({ id: "c2", pr_number: 77, pr_link: null, status: "no_findings", verdict: "approve", findings_count: 0, duration_ms: null })];
    renderView();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText("acme/api")).toBeInTheDocument();
    expect(first.getByRole("link", { name: "#482" })).toHaveAttribute("href", "/repos/r1/pulls/482");
    expect(first.getByText("Security Reviewer")).toBeInTheDocument();
    expect(first.getByText("Request changes")).toBeInTheDocument();
    expect(first.getByText("$0.012")).toHaveAttribute("title", "Reported by the CI job, not verified");
    expect(screen.getByText(/reported by the CI job and are not verified/)).toBeInTheDocument();
    expect(first.getByText("1m 05s")).toBeInTheDocument();
    expect(first.getByText("Failed")).toBeInTheDocument();
    expect(first.getByRole("link", { name: "View" })).toHaveAttribute("href", "https://github.com/acme/api/actions/runs/1");
    const second = within(rows[1]!);
    expect(second.queryByRole("link", { name: "#77" })).not.toBeInTheDocument();
    expect(second.getByText("#77")).toBeInTheDocument();
    expect(second.getByText("No findings")).toBeInTheDocument();
  });

  it("filters live in the URL and Refresh triggers a GitHub read", async () => {
    const user = userEvent.setup();
    renderView();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "failed");
    expect(replace).toHaveBeenCalledWith("/ci-runs?status=failed");
    await user.selectOptions(screen.getByRole("combobox", { name: "Time range" }), "30d");
    expect(replace).toHaveBeenLastCalledWith("/ci-runs?range=30d");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshMutate).toHaveBeenCalledTimes(1);
  });

  it("in-progress runs show as Running on top without being stored", () => {
    state.runs = [run()];
    state.refreshData = {
      ingested: 0,
      retry_at: null,
      errors: [],
      running: [run({ id: "running-1", status: "running", verdict: null, findings_count: null, cost_usd: null, duration_ms: null, pr_number: 9, pr_link: null })],
    };
    renderView();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Running")).toBeInTheDocument();
  });

  it("auto-refreshes every 60 s while visible, stops while hidden and when toggled off (AC-66)", () => {
    vi.useFakeTimers();
    renderView();
    act(() => vi.advanceTimersByTime(60_000));
    expect(refreshMutate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30_000));
    expect(refreshMutate).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(120_000);
    });
    expect(refreshMutate).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => vi.advanceTimersByTime(60_000));
    expect(refreshMutate).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("switch") ?? screen.getByText("auto-refresh on"));
    act(() => vi.advanceTimersByTime(180_000));
    expect(refreshMutate).toHaveBeenCalledTimes(2);
  });

  it("a rate limit keeps the stored rows, shows the retry time and blocks Refresh and auto-refresh (AC-68)", () => {
    vi.useFakeTimers();
    state.runs = [run()];
    const retryAt = new Date(Date.now() + 5 * 60_000).toISOString();
    state.refreshData = { ingested: 0, running: [], retry_at: retryAt, errors: [] };
    renderView();
    expect(screen.getByText(/GitHub rate limit reached/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(60_000));
    expect(refreshMutate).not.toHaveBeenCalled();
  });
});
