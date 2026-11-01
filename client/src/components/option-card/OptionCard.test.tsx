import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { OptionCard, OptionGroup } from "./OptionCard";

afterEach(cleanup);

function Demo({ onPick }: { onPick: (v: string) => void }) {
  const [v, setV] = React.useState("a");
  const pick = (x: string) => {
    setV(x);
    onPick(x);
  };
  return (
    <OptionGroup label="Mode">
      <OptionCard title="Alpha" selected={v === "a"} onSelect={() => pick("a")} tag="recommended" />
      <OptionCard title="Beta" selected={v === "b"} onSelect={() => pick("b")} />
      <OptionCard title="Gamma" selected={v === "c"} onSelect={() => pick("c")} disabled disabledReason="No token" />
    </OptionGroup>
  );
}

describe("OptionCard", () => {
  it("works as a radio group by keyboard and mouse, and skips disabled cards", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Demo onPick={onPick} />);
    const group = screen.getByRole("radiogroup", { name: "Mode" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /alpha/i })).toBeChecked();

    screen.getByRole("radio", { name: /alpha/i }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /beta/i })).toBeChecked();
    // Gamma is disabled: ArrowDown wraps to Alpha.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /alpha/i })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /gamma/i }));
    expect(onPick).not.toHaveBeenCalledWith("c");
    expect(screen.getByText("No token")).toBeInTheDocument();

    screen.getByRole("radio", { name: /beta/i }).focus();
    await user.keyboard(" ");
    expect(screen.getByRole("radio", { name: /beta/i })).toBeChecked();
  });
});
