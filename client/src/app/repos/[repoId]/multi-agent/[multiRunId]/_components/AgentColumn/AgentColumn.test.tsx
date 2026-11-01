import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import runs from "../../../../../../../../messages/en/runs.json";
import { column } from "@/test/multi-agent-fixtures";

// A controllable EventSource: the stream "ends" when a test calls onerror.
const sources: { url: string; onerror: (() => void) | null; close: () => void }[] = [];
class FakeEventSource {
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    sources.push(this as never);
  }
  addEventListener() {}
  close() {}
}
vi.stubGlobal("EventSource", FakeEventSource);

import { AgentColumn } from "./AgentColumn";

afterEach(() => {
  cleanup();
  sources.length = 0;
});

const renderColumn = (c: ReturnType<typeof column>, onTrace = vi.fn(), onStreamEnd = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs }}>
      <AgentColumn column={c} onTrace={onTrace} onStreamEnd={onStreamEnd} />
    </NextIntlClientProvider>,
  );
  return { onTrace, onStreamEnd };
};

describe("AgentColumn", () => {
  it("a running column streams its events and refetches when the stream ends", async () => {
    const { onStreamEnd } = renderColumn(column(1, { status: "running", score: null, duration_ms: null, cost_usd: null, findings: [] }));
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.url).toContain("/runs/run1/events");
    expect(onStreamEnd).not.toHaveBeenCalled();
    await act(async () => sources[0]!.onerror?.());
    expect(onStreamEnd).toHaveBeenCalledTimes(1);
  });

  it("a done column shows score, findings, count and opens the trace; no stream is opened", async () => {
    const user = userEvent.setup();
    const { onTrace } = renderColumn(column(2));
    expect(sources).toHaveLength(0);
    expect(screen.queryByText("done")).not.toBeInTheDocument(); // a done column shows its score instead of a status pill
    expect(screen.getByLabelText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Finding 2")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts:10")).toBeInTheDocument();
    expect(screen.getByText("1 finding")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View trace" }));
    expect(onTrace).toHaveBeenCalledWith("run2");
  });

  it("a failed or cancelled column shows the error and keeps View trace", () => {
    renderColumn(column(1, { status: "failed", error: "Provider key missing", score: null, findings: [] }));
    expect(screen.getByRole("alert")).toHaveTextContent("Provider key missing");
    expect(screen.getByRole("button", { name: "View trace" })).toBeInTheDocument();
    cleanup();
    renderColumn(column(1, { status: "cancelled", error: "Cancelled by user", score: null, findings: [] }));
    expect(screen.getByText("cancelled")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Cancelled by user");
  });
});
