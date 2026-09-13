import { render, screen } from "@testing-library/react";
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
