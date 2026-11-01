import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import runs from "../../../../../../../../messages/en/runs.json";
import { column, take } from "@/test/multi-agent-fixtures";
import { DisagreementsBlock } from "./DisagreementsBlock";

afterEach(cleanup);

const conflict = (line: number, conflictFlag: boolean, takes: Conflict["takes"]): Conflict => ({
  file: "src/a.ts",
  line,
  end_line: line,
  title: `Topic ${line}`,
  conflict: conflictFlag,
  takes,
});

const renderBlock = (conflicts: Conflict[], columns = [column(1), column(2)]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ runs }}>
      <DisagreementsBlock conflicts={conflicts} columns={columns} />
    </NextIntlClientProvider>,
  );

describe("DisagreementsBlock", () => {
  it("lists locations with a cell per agent; the conflicts toggle defaults off and filters", async () => {
    const user = userEvent.setup();
    renderBlock([
      conflict(10, true, [take(1, "CRITICAL", "Hardcoded key"), take(2, "ignored")]),
      conflict(30, false, [take(1, "WARNING", "Same"), take(2, "WARNING", "Same too")]),
    ]);
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Show only conflicts/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("src/a.ts:10")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts:30")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded key")).toBeInTheDocument();
    expect(screen.getByText("did not flag")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /Show only conflicts/ }));
    expect(screen.getByText("src/a.ts:10")).toBeInTheDocument();
    expect(screen.queryByText("src/a.ts:30")).not.toBeInTheDocument();
  });

  it("zero conflicts says the agents agree; the toggle then shows an empty state", async () => {
    const user = userEvent.setup();
    renderBlock([conflict(10, false, [take(1, "WARNING", "a"), take(2, "WARNING", "b")])]);
    expect(screen.getByText("Agents agree on every location")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: /Show only conflicts/ }));
    expect(screen.getByText("No conflicts to show.")).toBeInTheDocument();
  });

  it("a failed, cancelled or running agent reads 'no result', not 'did not flag'", () => {
    renderBlock(
      [conflict(10, false, [take(1, "CRITICAL", "x"), take(2, "no_result"), take(3, "no_result")])],
      [column(1), column(2, { status: "failed" }), column(3, { status: "done" })],
    );
    expect(screen.getAllByText("no result")).toHaveLength(2);
    expect(screen.queryByText("did not flag")).not.toBeInTheDocument();
  });

  it("is hidden with a single completed agent", () => {
    renderBlock([], [column(1), column(2, { status: "failed" })]);
    expect(screen.queryByText("Where agents disagree")).not.toBeInTheDocument();
  });

  it("caps the rows at 200 with a Show more control", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 205 }, (_, i) => conflict(i + 1, true, [take(1, "WARNING", "n"), take(2, "ignored")]));
    renderBlock(many);
    expect(screen.getAllByRole("listitem")).toHaveLength(200);
    await user.click(screen.getByRole("button", { name: "Show more (5)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(205);
  });
});
