import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import runs from "../../../../../../../../messages/en/runs.json";
import prReview from "../../../../../../../../messages/en/prReview.json";
import { column, multiRun } from "@/test/multi-agent-fixtures";

const mutate = vi.fn();
const finding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded key",
  file: "src/a.ts",
  start_line: 10,
  end_line: 12,
  rationale: "A live key is committed.",
  suggestion: "Use an env var.",
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};
vi.mock("@/lib/hooks/reviews", () => ({
  useRunFindings: (runId: string | undefined) => ({
    data: runId === "run1" ? { findings: [finding] } : { findings: [] },
    isLoading: false,
  }),
  useFindingAction: () => ({ mutate, isPending: false }),
}));

import { TabsView } from "./TabsView";

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

const renderTabs = (onTrace = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs, prReview }}>
      <TabsView run={multiRun([column(1), column(2), column(3)])} onTrace={onTrace} />
    </NextIntlClientProvider>,
  );
  return onTrace;
};

describe("TabsView", () => {
  it("shows a tab per agent with its score and the agent's summary card", async () => {
    const user = userEvent.setup();
    const onTrace = renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent("Agent 171");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Summary 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View trace" }));
    expect(onTrace).toHaveBeenCalledWith("run1");
  });

  it("expands a finding, accepts it, and shows Learn / Turn into eval case disabled with a tooltip and no Reply", async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByText("Hardcoded key"));
    expect(screen.getByText("Use an env var.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learn" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Learn" }).parentElement).toHaveAttribute("title", "Coming soon");
    expect(screen.queryByText(/Reply to author/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "f1", action: "dismiss", prId: "pr1" });
  });

  it("moves between tabs with the arrow, Home and End keys", async () => {
    const user = userEvent.setup();
    renderTabs();
    screen.getAllByRole("tab")[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab")[1]).toHaveFocus();
    expect(screen.getByText("Summary 2")).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(screen.getAllByRole("tab")[2]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getAllByRole("tab")[2]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
  });
});
