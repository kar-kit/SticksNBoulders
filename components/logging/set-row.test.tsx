import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetRow } from "./set-row";
import type { LoggableSet } from "@/lib/logging/set";

function set(overrides: Partial<LoggableSet> = {}): LoggableSet {
  return { loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false, ...overrides };
}

describe("SetRow — logged states", () => {
  it("shows the numbers as plain values, with no edit affordance", () => {
    render(<SetRow index={1} set={set()} state="logged" />);
    expect(screen.getByLabelText("Set 1 weight in kilograms")).toHaveTextContent("142.5");
    expect(screen.getByLabelText("Set 1 reps")).toHaveTextContent("5");
    expect(screen.getByLabelText("Set 1 RPE")).toHaveTextContent("8");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks a warm-up with W and shows no RPE", () => {
    render(<SetRow index="W" set={set({ isWarmup: true, rpe: null })} state="logged" />);
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByLabelText("Warm-up set RPE")).toHaveTextContent("—");
  });

  it("renders a logged tick", () => {
    render(<SetRow index={1} set={set()} state="logged" />);
    expect(screen.getByLabelText("Logged")).toBeInTheDocument();
  });
});

describe("SetRow — pending sync", () => {
  it("shows a quiet dot and no error language", () => {
    render(<SetRow index={2} set={set()} state="logged" pendingSync />);
    expect(screen.getByLabelText("Queued, will sync")).toBeInTheDocument();
    expect(screen.getByText("queued · no signal")).toBeInTheDocument();
    // Offline is normal. Nothing here may read as a failure.
    expect(screen.queryByText(/error|failed|retry/i)).not.toBeInTheDocument();
  });

  it("still shows the set as logged while it is queued", () => {
    render(<SetRow index={2} set={set()} state="logged" pendingSync />);
    expect(screen.getByLabelText("Logged")).toBeInTheDocument();
  });

  it("shows no dot when the set is synced", () => {
    render(<SetRow index={2} set={set()} state="logged" />);
    expect(screen.queryByLabelText("Queued, will sync")).not.toBeInTheDocument();
  });
});

describe("SetRow — video uploading", () => {
  it("reports progress without blocking the set", () => {
    render(<SetRow index={3} set={set()} state="logged" uploadPercent={38} />);
    const bar = screen.getByRole("progressbar", { name: "Video uploading" });
    expect(bar).toHaveAttribute("aria-valuenow", "38");
    expect(screen.getByText("video uploading 38%")).toBeInTheDocument();
    expect(screen.getByLabelText("Logged")).toBeInTheDocument();
  });

  it("clamps a percentage outside 0-100 rather than rendering it", () => {
    render(<SetRow index={3} set={set()} state="logged" uploadPercent={140} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("SetRow — active row", () => {
  it("exposes each field as its own tap target", () => {
    render(<SetRow index={4} set={set({ rpe: null })} state="active" />);
    expect(screen.getByRole("button", { name: "Set 4 weight in kilograms" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Set 4 reps" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Set 4 RPE" })).toBeEnabled();
  });

  it("logs the set in one tap when the values are already right", () => {
    // The common case, and it must stay one tap.
    const onConfirm = vi.fn();
    render(<SetRow index={4} set={set()} state="active" onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: "Log Set 4" });
    expect(confirm).toBeEnabled();
    return userEvent.click(confirm).then(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it("routes a field tap to its own handler, not to confirm", async () => {
    const onPressLoad = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SetRow index={4} set={set()} state="active" onPressLoad={onPressLoad} onConfirm={onConfirm} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set 4 weight in kilograms" }));
    expect(onPressLoad).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cannot be confirmed while the numbers are missing", async () => {
    const onConfirm = vi.fn();
    render(
      <SetRow index={4} set={set({ loadKg: null, reps: null })} state="active" onConfirm={onConfirm} />,
    );
    const confirm = screen.getByRole("button", { name: "Log Set 4" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a placeholder rather than a zero in an empty cell", () => {
    render(<SetRow index={4} set={set({ loadKg: null })} state="active" />);
    expect(screen.getByRole("button", { name: "Set 4 weight in kilograms" })).toHaveTextContent("KG");
  });

  it("does not offer RPE on a warm-up", () => {
    render(<SetRow index="W" set={set({ isWarmup: true, rpe: null })} state="active" />);
    expect(screen.queryByRole("button", { name: "Warm-up set RPE" })).not.toBeInTheDocument();
  });
});

describe("SetRow — video required", () => {
  const required = set({ videoRequired: true, rpe: null });

  it("blocks completion until a clip exists", async () => {
    const onConfirm = vi.fn();
    render(<SetRow index={5} set={required} state="active" onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: "Log Set 5" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("puts the camera in the RPE cell and says why", () => {
    render(<SetRow index={5} set={required} state="active" />);
    expect(
      screen.getByRole("button", { name: /Film Set 5 — video required/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set 5 RPE" })).not.toBeInTheDocument();
  });

  it("returns the RPE cell once a clip is attached, and unblocks confirm", () => {
    render(<SetRow index={5} set={set({ videoRequired: true, hasVideo: true, rpe: null })} state="active" />);
    expect(screen.getByRole("button", { name: "Set 5 RPE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Set 5" })).toBeEnabled();
  });

  it("returns the RPE cell after an explicit skip", () => {
    render(
      <SetRow index={5} set={set({ videoRequired: true, videoSkipped: true, rpe: null })} state="active" />,
    );
    expect(screen.getByRole("button", { name: "Set 5 RPE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Set 5" })).toBeEnabled();
  });

  it("calls the film handler from the camera cell", async () => {
    const onFilm = vi.fn();
    render(<SetRow index={5} set={required} state="active" onFilm={onFilm} />);
    await userEvent.click(screen.getByRole("button", { name: /Film Set 5/ }));
    expect(onFilm).toHaveBeenCalledTimes(1);
  });
});

describe("SetRow — suggestion note", () => {
  it("shows where a suggested load came from", () => {
    render(
      <SetRow index={4} set={set({ loadKg: 150 })} state="active" note="suggested from RPE 7 @ 142.5" />,
    );
    expect(screen.getByText("suggested from RPE 7 @ 142.5")).toBeInTheDocument();
  });

  it("leaves the load editable, because an override is data and not disobedience", () => {
    render(<SetRow index={4} set={set({ loadKg: 150 })} state="active" note="suggested from RPE 7 @ 142.5" />);
    expect(screen.getByRole("button", { name: "Set 4 weight in kilograms" })).toBeEnabled();
  });
});

describe("SetRow — column alignment", () => {
  it("left-aligns logged values so they sit under their column headers", () => {
    render(<SetRow index={1} set={set()} state="logged" />);
    expect(screen.getByLabelText("Set 1 reps")).toHaveClass("justify-start");
    expect(screen.getByLabelText("Set 1 RPE")).toHaveClass("justify-start");
  });

  it("centres the active row's boxed cells, which have their own borders", () => {
    render(<SetRow index={4} set={set()} state="active" />);
    expect(screen.getByRole("button", { name: "Set 4 reps" })).toHaveClass("justify-center");
    // The load cell stays left-aligned even when active: it is the widest
    // column and a 3-digit load jumping about as it is typed reads badly.
    expect(screen.getByRole("button", { name: "Set 4 weight in kilograms" })).toHaveClass(
      "justify-start",
    );
  });
});
