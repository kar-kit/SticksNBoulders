import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RpeSheet } from "./rpe-sheet";

describe("RpeSheet", () => {
  it("offers all eleven answers in one sheet", () => {
    render(<RpeSheet setIndex={1} value={null} onSelect={vi.fn()} />);
    for (const label of ["6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Not sure" })).toBeInTheDocument();
  });

  it("says the entry is optional", () => {
    render(<RpeSheet setIndex={1} value={null} onSelect={vi.fn()} />);
    expect(screen.getByText("OPTIONAL")).toBeInTheDocument();
    expect(screen.getByText("RPE · SET 1")).toBeInTheDocument();
  });

  it("reports a half point as its own value", async () => {
    const onSelect = vi.fn();
    render(<RpeSheet setIndex={2} value={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "7.5" }));
    expect(onSelect).toHaveBeenCalledWith(7.5);
  });

  it("records 'Not sure' as null rather than a guessed number", () => {
    // A forced guess pollutes the personal RPE curve worse than a null does.
    const onSelect = vi.fn();
    render(<RpeSheet setIndex={2} value={null} onSelect={onSelect} />);
    return userEvent.click(screen.getByRole("button", { name: "Not sure" })).then(() => {
      expect(onSelect).toHaveBeenCalledWith(null);
      expect(onSelect).not.toHaveBeenCalledWith(expect.any(Number));
    });
  });

  it("marks the current value as pressed", () => {
    render(<RpeSheet setIndex={1} value={8} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "8" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "9" })).toHaveAttribute("aria-pressed", "false");
  });

  it("distinguishes an unanswered sheet from a deliberate 'Not sure'", () => {
    const { rerender } = render(<RpeSheet setIndex={1} value={8} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Not sure" })).toHaveAttribute("aria-pressed", "false");
    rerender(<RpeSheet setIndex={1} value={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Not sure" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("RpeSheet's Under 6 sub-menu (F10)", () => {
  it("keeps 5, 4 and 3 behind one chip, so the main grid is unchanged", () => {
    render(<RpeSheet setIndex={1} value={null} onSelect={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Under 6" });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    for (const label of ["5", "4", "3"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("opens 5, 4 and 3 in that order, nearest the grid first", async () => {
    render(<RpeSheet setIndex={1} value={null} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Under 6" }));
    expect(screen.getByRole("button", { name: "Under 6" })).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "RPE under 6" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["5", "4", "3"]);
  });

  it("records nothing for opening it, only for a value", async () => {
    const onSelect = vi.fn();
    render(<RpeSheet setIndex={1} value={8} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Under 6" }));
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it("closes again on a second tap", async () => {
    render(<RpeSheet setIndex={1} value={null} onSelect={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Under 6" });
    await userEvent.click(chip);
    await userEvent.click(chip);
    expect(screen.queryByRole("group", { name: "RPE under 6" })).not.toBeInTheDocument();
  });

  it("opens by itself on a set that already carries a sub-6 answer, with it pressed", () => {
    render(<RpeSheet setIndex={1} value={5} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Under 6" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Not sure" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("RpeSheet inside the Log screen's sheet", () => {
  it("leaves the edge and fill to the sheet", () => {
    render(<RpeSheet setIndex={1} value={null} onSelect={vi.fn()} inSheet />);
    const sheet = screen.getByRole("region", { name: "RPE for set 1" });
    expect(sheet.className).not.toContain("border-t");
  });
});

describe("RpeSheet's Failed switch (F19)", () => {
  it("sits under the chips as a labelled switch, described, and does not answer the RPE", async () => {
    const onSelect = vi.fn();
    const onToggleFailed = vi.fn();
    render(<RpeSheet setIndex={2} value={null} onSelect={onSelect} failed={false} onToggleFailed={onToggleFailed} />);
    const toggle = screen.getByRole("switch", { name: "Failed" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Reps are the ones you completed");
    await userEvent.click(toggle);
    expect(onToggleFailed).toHaveBeenCalledWith(true);
    // A switch, not an answer: the RPE is still the athlete's to give.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows on for a failed row, and is absent without a handler", () => {
    const { rerender } = render(<RpeSheet setIndex={1} value={9} onSelect={vi.fn()} failed onToggleFailed={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Failed" })).toHaveAttribute("aria-checked", "true");
    rerender(<RpeSheet setIndex={1} value={9} onSelect={vi.fn()} />);
    expect(screen.queryByRole("switch", { name: "Failed" })).not.toBeInTheDocument();
  });
});
