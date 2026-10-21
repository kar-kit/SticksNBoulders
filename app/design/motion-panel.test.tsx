import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AthleteMotionPanel } from "./motion-panel";

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).vibrate;
});

describe("the athlete motion panel", () => {
  it("presses its buttons the athlete's way", () => {
    const { container } = render(<AthleteMotionPanel />);
    expect(container.querySelector(".athlete-motion")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Press and hold" }).className).toContain("athlete:tap");
  });

  it("opens the sheet, and unmounts it once closed with nothing left to play", async () => {
    // jsdom has no stylesheet, so the exit has no duration: it goes at once.
    const user = userEvent.setup();
    render(<AthleteMotionPanel />);
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    expect(screen.getByRole("dialog", { name: "Demo sheet" }).className).toContain("animate-sheet-in");
    await user.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(screen.queryByRole("dialog", { name: "Demo sheet" })).not.toBeInTheDocument();
  });

  it("slides added rows in, and leaves the one that was there still", async () => {
    const user = userEvent.setup();
    render(<AthleteMotionPanel />);
    await user.click(screen.getByRole("button", { name: "Add row" }));
    expect(screen.getByText("Squat 5 × 140").className).not.toContain("animate-row-in");
    expect(screen.getByText("Set 2 planned").className).toContain("animate-row-in");
  });

  it("ticks the set with a success buzz", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
    const user = userEvent.setup();
    render(<AthleteMotionPanel />);
    await user.click(screen.getByRole("button", { name: "Log set" }));
    expect(screen.getByLabelText("Logged").className).toContain("animate-tick-in");
    expect(vibrate).toHaveBeenCalledWith([12, 60, 18]);
  });
});
