import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetRow, SetRowHeader, SWIPE_DELETE_PX } from "./set-row";
import type { LoggableSet } from "@/lib/logging/set";

const haptic = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/ui/haptics", () => ({ haptic }));

// afterExit is real by default (jsdom has no stylesheet, so it finishes at
// once). One test holds the exit open to see the row while it leaves.
const exit = vi.hoisted(() => ({ hold: false, done: null as null | (() => void) }));
vi.mock("@/components/ui/motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/motion")>();
  return {
    ...real,
    afterExit: (el: Element | null, done: () => void) => {
      if (!exit.hold) return real.afterExit(el, done);
      exit.done = done;
      return () => {};
    },
  };
});

beforeEach(() => {
  haptic.mockClear();
  exit.hold = false;
  exit.done = null;
});

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

describe("SetRow — video required, on a row that can film (the blueprint's gate)", () => {
  const required = set({ videoRequired: true, rpe: null });
  const film = () => {};

  it("blocks completion until a clip exists", async () => {
    const onConfirm = vi.fn();
    render(<SetRow index={5} set={required} state="active" onConfirm={onConfirm} onFilm={film} />);
    const confirm = screen.getByRole("button", { name: "Log Set 5" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("puts the camera in the RPE cell and says why", () => {
    render(<SetRow index={5} set={required} state="active" onFilm={film} />);
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

describe("SetRow — the coach's video ask as a badge (F5, Order 30)", () => {
  const badge = () => document.querySelector("[data-video-badge]");

  it("badges a planned row before it is logged, and never blocks the confirm", async () => {
    const onConfirm = vi.fn();
    render(<SetRow index={1} set={set({ videoRequired: true })} state="active" onConfirm={onConfirm} />);
    expect(screen.getByRole("img", { name: "Set 1: your coach asked for a video" })).toBeInTheDocument();
    expect(badge()).toHaveAttribute("data-video-badge", "requested");
    // RPE stays an RPE cell; the camera does not take it without a way to film.
    expect(screen.getByRole("button", { name: "Set 1 RPE" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log Set 1" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("badges a row waiting behind the active one too", () => {
    render(<SetRow index={2} set={set({ videoRequired: true })} state="planned" />);
    expect(screen.getByRole("img", { name: "Set 2: your coach asked for a video" })).toBeInTheDocument();
  });

  it("keeps asking on a logged set until a clip is attached", () => {
    render(<SetRow index={1} set={set({ videoRequired: true })} state="logged" />);
    expect(screen.getByRole("img", { name: "Set 1: your coach asked for a video, not filmed yet" })).toBeInTheDocument();
    expect(badge()).toHaveAttribute("data-video-badge", "missing");
  });

  it("goes quiet once the logged set has its clip", () => {
    render(<SetRow index={1} set={set({ videoRequired: true, hasVideo: true })} state="logged" />);
    expect(screen.getByRole("img", { name: "Set 1: video attached" })).toBeInTheDocument();
    expect(badge()).toHaveAttribute("data-video-badge", "filmed");
  });

  it("shows no badge on a set nobody asked to see", () => {
    render(<SetRow index={1} set={set()} state="active" />);
    expect(badge()).toBeNull();
  });

  it("hands the badge over to the camera cell where the row can film", () => {
    render(<SetRow index={1} set={set({ videoRequired: true, rpe: null })} state="active" onFilm={() => {}} />);
    expect(badge()).toBeNull();
    expect(screen.getByRole("button", { name: /Film Set 1/ })).toBeInTheDocument();
  });
});

describe("SetRow — arriving", () => {
  it("slides in on the row-in token when it has just been added", () => {
    const { container } = render(<SetRow index={2} set={set()} state="planned" arrived />);
    expect(container.firstElementChild!.className).toContain("motion-safe:animate-row-in");
  });

  it("does not when it was already there", () => {
    const { container } = render(<SetRow index={2} set={set()} state="planned" />);
    expect(container.firstElementChild!.className).not.toContain("animate-row-in");
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

describe("SetRow — suggested marker", () => {
  it("marks an untouched suggested load, on the load and nowhere else", () => {
    render(<SetRow index={4} set={set({ loadKg: 150 })} state="active" suggested />);
    expect(screen.getAllByText("Suggested")).toHaveLength(1);
    // The marker belongs to the load cell: it is that button's description.
    expect(screen.getByRole("button", { name: "Set 4 weight in kilograms" })).toHaveAccessibleDescription(
      "Suggested",
    );
    expect(screen.getByRole("button", { name: "Set 4 reps" })).not.toHaveAccessibleDescription();
  });

  it("shows no marker for a load that is not a suggestion", () => {
    render(<SetRow index={4} set={set({ loadKg: 150 })} state="active" note="from your last session" />);
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("marks a planned row waiting behind the active one", () => {
    render(<SetRow index={5} set={set({ loadKg: 150 })} state="planned" suggested />);
    expect(screen.getByText("Suggested")).toBeInTheDocument();
  });

  it("never marks a logged set, whatever it was prefilled from", () => {
    render(<SetRow index={4} set={set({ loadKg: 150 })} state="logged" suggested />);
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("leaves the cell tappable and its name unchanged, so the pad opens as before", async () => {
    const onPressLoad = vi.fn();
    render(<SetRow index={4} set={set({ loadKg: 150 })} state="active" suggested onPressLoad={onPressLoad} />);
    await userEvent.click(screen.getByRole("button", { name: "Set 4 weight in kilograms" }));
    expect(onPressLoad).toHaveBeenCalledTimes(1);
    // Nothing else appears: no spinner, no status, no alert.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("drops the marker as soon as the row is no longer suggested", () => {
    const { rerender } = render(<SetRow index={4} set={set({ loadKg: 150 })} state="active" suggested />);
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    rerender(<SetRow index={4} set={set({ loadKg: 155 })} state="active" suggested={false} />);
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
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

describe("SetRow — an athlete who reads pounds", () => {
  it("shows the stored kilos in pounds and says so", () => {
    render(<SetRow index={1} set={set({ loadKg: 102.058 })} state="logged" unit="lb" />);
    expect(screen.getByLabelText("Set 1 weight in pounds")).toHaveTextContent("225");
  });

  it("asks for pounds on an empty active row", () => {
    render(<SetRow index={1} set={set({ loadKg: null })} state="active" unit="lb" />);
    expect(screen.getByRole("button", { name: "Set 1 weight in pounds" })).toHaveTextContent("LB");
  });

  it("heads the column in pounds", () => {
    render(<SetRowHeader unit="lb" />);
    expect(screen.getByText("LB")).toBeInTheDocument();
    expect(screen.queryByText("KG")).not.toBeInTheDocument();
  });
});

describe("SetRow — swipe to delete", () => {
  const reveal = (container: HTMLElement) => container.querySelector("[data-swipe-reveal]");

  it("shows nothing behind a row at rest", () => {
    const { container } = render(<SetRow index={1} set={set()} state="logged" onDelete={() => {}} />);
    expect(reveal(container)).toBeNull();
  });

  it("uncovers a red Delete as the row slides, and arms it past the threshold", () => {
    const onDelete = vi.fn();
    const { container } = render(<SetRow index={1} set={set()} state="logged" onDelete={onDelete} />);
    const row = screen.getByRole("group", { name: "Set 1" });

    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 260, clientY: 10 });
    expect(reveal(container)).toHaveTextContent("Delete");
    expect(reveal(container)).toHaveAttribute("data-swipe-reveal", "showing");
    // Decorative: the tap-to-open Delete button is what a screen reader uses.
    expect(reveal(container)).toHaveAttribute("aria-hidden", "true");

    fireEvent.pointerMove(row, { clientX: 180, clientY: 10 });
    expect(reveal(container)).toHaveAttribute("data-swipe-reveal", "armed");

    fireEvent.pointerUp(row, { clientX: 180, clientY: 10 });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(reveal(container)).toBeNull();
  });

  it("hides the reveal again when a short drag is let go", () => {
    const onDelete = vi.fn();
    const { container } = render(<SetRow index={1} set={set()} state="logged" onDelete={onDelete} />);
    const row = screen.getByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 250, clientY: 10 });
    fireEvent.pointerUp(row, { clientX: 250, clientY: 10 });
    expect(onDelete).not.toHaveBeenCalled();
    expect(reveal(container)).toBeNull();
  });

  it("offers no swipe on a set the coach has commented on", () => {
    const { container } = render(
      <SetRow index={1} set={set()} state="logged" onDelete={() => {}} deleteBlocked="Your coach commented." />,
    );
    const row = screen.getByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 180, clientY: 10 });
    expect(reveal(container)).toBeNull();
  });
});

describe("SetRow — swipe on a row not logged yet", () => {
  const reveal = (container: HTMLElement) => container.querySelector("[data-swipe-reveal]");
  const drag = (row: HTMLElement, to: number) => {
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: to, clientY: 10 });
  };

  it("has no visible remove button any more", () => {
    render(<SetRow index={2} set={set()} state="planned" onDiscard={() => {}} />);
    expect(screen.queryByText("×")).not.toBeInTheDocument();
  });

  it("removes a planned row with a swipe past the threshold", () => {
    const onDiscard = vi.fn();
    const { container } = render(<SetRow index={2} set={set()} state="planned" onDiscard={onDiscard} />);
    const row = screen.getByRole("group", { name: "Set 2" });
    drag(row, 260);
    expect(reveal(container)).toHaveAttribute("data-swipe-reveal", "showing");
    fireEvent.pointerMove(row, { clientX: 300 - SWIPE_DELETE_PX - 4, clientY: 10 });
    expect(reveal(container)).toHaveAttribute("data-swipe-reveal", "armed");
    fireEvent.pointerUp(row);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("swipes the active row away too, so a row added by mistake can always go", () => {
    const onDiscard = vi.fn();
    render(<SetRow index={1} set={set()} state="active" onDiscard={onDiscard} />);
    const row = screen.getByRole("group", { name: "Set 1" });
    drag(row, 150);
    fireEvent.pointerUp(row);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("springs back from a short drag and does not open the pad on the cell it started over", () => {
    const onDiscard = vi.fn();
    const onPressLoad = vi.fn();
    const { container } = render(
      <SetRow index={2} set={set()} state="planned" onDiscard={onDiscard} onPressLoad={onPressLoad} />,
    );
    const cell = screen.getByRole("button", { name: "Set 2 weight in kilograms" });
    fireEvent.pointerDown(cell, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(cell, { clientX: 250, clientY: 10 });
    fireEvent.pointerUp(cell);
    fireEvent.click(cell);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onPressLoad).not.toHaveBeenCalled();
    expect(reveal(container)).toBeNull();
    const row = screen.getByRole("group", { name: "Set 2" });
    // Back at rest, on the spring.
    expect(row.style.transform).toBe("");
    expect(row.className).toContain("motion-safe:ease-spring");

    // And the next real tap is a tap.
    fireEvent.pointerDown(cell, { clientX: 300, clientY: 10 });
    fireEvent.pointerUp(cell);
    fireEvent.click(cell);
    expect(onPressLoad).toHaveBeenCalledTimes(1);
  });

  it("does not swipe on a vertical drag, which is a scroll", () => {
    const onDiscard = vi.fn();
    const { container } = render(<SetRow index={2} set={set()} state="planned" onDiscard={onDiscard} />);
    const row = screen.getByRole("group", { name: "Set 2" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 280, clientY: 120 });
    fireEvent.pointerUp(row);
    expect(reveal(container)).toBeNull();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("keeps a non-gesture remove for a screen reader and a keyboard", async () => {
    const onDiscard = vi.fn();
    render(<SetRow index={2} set={set()} state="planned" onDiscard={onDiscard} />);
    const remove = screen.getByRole("button", { name: "Remove planned Set 2" });
    // Out of sight until focused, never out of the accessibility tree.
    expect(remove).toHaveClass("sr-only");
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(remove).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("offers no swipe and no remove without a discard handler", () => {
    const { container } = render(<SetRow index={2} set={set()} state="planned" />);
    drag(screen.getByRole("group", { name: "Set 2" }), 150);
    expect(reveal(container)).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove planned/ })).not.toBeInTheDocument();
  });
});

describe("SetRow — the swipe's feel", () => {
  it("follows the finger, with no transition while it is held", () => {
    render(<SetRow index={1} set={set()} state="logged" onDelete={() => {}} />);
    const row = screen.getByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 240, clientY: 10 });
    expect(row.style.transform).toBe("translateX(-60px)");
    expect(row.className).not.toContain("transition-transform");
    // Never to the right: there is nothing behind that side.
    fireEvent.pointerMove(row, { clientX: 340, clientY: 10 });
    expect(row.style.transform).toBe("");
  });

  it("buzzes medium once on arming, not on every move past the line, and again on re-arming", () => {
    render(<SetRow index={1} set={set()} state="logged" onDelete={() => {}} />);
    const row = screen.getByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 250, clientY: 10 });
    expect(haptic).not.toHaveBeenCalled();
    fireEvent.pointerMove(row, { clientX: 190, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 170, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 150, clientY: 10 });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith("medium");
    fireEvent.pointerMove(row, { clientX: 250, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 150, clientY: 10 });
    expect(haptic).toHaveBeenCalledTimes(2);
  });

  it("plays the exit before deleting: the row slides off and fades, inert, then goes", () => {
    exit.hold = true;
    const onDelete = vi.fn();
    const { container } = render(<SetRow index={1} set={set()} state="logged" onDelete={onDelete} />);
    const row = screen.getByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 150, clientY: 10 });
    fireEvent.pointerUp(row);

    expect(onDelete).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("translateX(-100%)");
    expect(row.className).toContain("motion-safe:ease-in");
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveClass("motion-safe:animate-fade-out");
    expect(outer).toHaveAttribute("inert");
    expect(container.querySelector("[data-swipe-reveal]")).toHaveAttribute("data-swipe-reveal", "armed");

    act(() => exit.done?.());
    expect(onDelete).toHaveBeenCalledTimes(1);
    // Kept by the screen (a delete it refused): back at rest, not invisible.
    expect(outer).not.toHaveAttribute("inert");
    expect(row.style.transform).toBe("");
  });

  it("does not open a logged row's actions after a swipe that fell short", () => {
    const onSelect = vi.fn();
    render(<SetRow index={1} set={set()} state="logged" onDelete={() => {}} onSelect={onSelect} />);
    const row = screen.getByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 250, clientY: 10 });
    fireEvent.pointerUp(row);
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("SetRow — warm-up from the set number", () => {
  it("makes the number a button on a logged row, and leaves the row's actions alone", async () => {
    const onToggleWarmup = vi.fn();
    const onSelect = vi.fn();
    render(
      <SetRow index={2} set={set()} state="logged" onSelect={onSelect} onToggleWarmup={onToggleWarmup} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set 2: mark as warm-up" }));
    expect(onToggleWarmup).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(haptic).toHaveBeenCalledWith("light");
  });

  it("works from the keyboard without opening the row's actions", async () => {
    const onToggleWarmup = vi.fn();
    const onSelect = vi.fn();
    render(
      <SetRow index={2} set={set()} state="logged" onSelect={onSelect} onToggleWarmup={onToggleWarmup} />,
    );
    screen.getByRole("button", { name: "Set 2: mark as warm-up" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onToggleWarmup).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("names the way back on a warm-up, on a row not logged yet", async () => {
    const onToggleWarmup = vi.fn();
    render(
      <SetRow index="W" set={set({ isWarmup: true, rpe: null })} state="active" onToggleWarmup={onToggleWarmup} />,
    );
    const toggle = screen.getByRole("button", { name: "Warm-up set: make it a working set" });
    expect(toggle).toHaveTextContent("W");
    await userEvent.click(toggle);
    expect(onToggleWarmup).toHaveBeenCalledTimes(1);
  });

  it("pops the new label in on a flip, and not on first render", () => {
    const { rerender } = render(<SetRow index={2} set={set()} state="logged" onToggleWarmup={() => {}} />);
    const label = () => screen.getByRole("button", { name: /Set 2|Warm-up set/ }).firstElementChild;
    expect(label()).not.toHaveClass("motion-safe:animate-spring-pop");
    rerender(<SetRow index="W" set={set({ isWarmup: true, rpe: null })} state="logged" onToggleWarmup={() => {}} />);
    expect(label()).toHaveTextContent("W");
    expect(label()).toHaveClass("motion-safe:animate-spring-pop");
  });

  it("is a plain label without a handler", () => {
    render(<SetRow index={2} set={set()} state="logged" />);
    expect(screen.queryByRole("button", { name: /mark as warm-up/ })).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("SetRow — Previous (F6)", () => {
  it("shows last time on a line under a logged row, as text, not a button", () => {
    render(<SetRow index={1} set={set()} state="logged" previous={{ loadKg: 140, reps: 5 }} />);
    expect(screen.getByLabelText("Set 1 last time: 140 kilograms for 5 reps")).toHaveTextContent("PREV 140 × 5");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("copies on a row not logged yet, with a light tap answer", async () => {
    const onCopyPrevious = vi.fn();
    render(
      <SetRow
        index={2}
        set={set({ loadKg: null, reps: null, rpe: null })}
        state="active"
        previous={{ loadKg: 145, reps: 3 }}
        onCopyPrevious={onCopyPrevious}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set 2: use last time, 145 kilograms for 3 reps" }));
    expect(onCopyPrevious).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith("light");
  });

  it("reads in pounds for an athlete who reads pounds", () => {
    render(<SetRow index={1} set={set()} state="logged" unit="lb" previous={{ loadKg: 142.882, reps: 5 }} />);
    expect(screen.getByLabelText("Set 1 last time: 315 pounds for 5 reps")).toHaveTextContent("PREV 315 × 5");
  });

  it("keeps the suggestion note beside it", () => {
    render(
      <SetRow
        index={2}
        set={set()}
        state="active"
        note="suggested from RPE 7 @ 140"
        previous={{ loadKg: 140, reps: 5 }}
        onCopyPrevious={() => {}}
      />,
    );
    expect(screen.getByText("suggested from RPE 7 @ 140")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use last time/ })).toBeInTheDocument();
  });

  it("adds no line when there is no last time", () => {
    const { container } = render(<SetRow index={1} set={set()} state="active" onCopyPrevious={() => {}} />);
    expect(container.querySelector("[data-previous]")).toBeNull();
  });
});

describe("SetRow — PR badge (F6)", () => {
  it("badges a logged record, and says which", () => {
    render(<SetRow index={1} set={set()} state="logged" pr={["e1rm", "weight"]} />);
    const badge = screen.getByRole("img", { name: "Set 1: personal record, estimated one-rep max and heaviest weight" });
    expect(badge).toHaveTextContent("PR");
    expect(badge.className).not.toContain("animate-spring-pop");
  });

  it("reads Rep PR when reps at the load are the only record", () => {
    render(<SetRow index={1} set={set()} state="logged" pr={["reps"]} />);
    const badge = screen.getByRole("img", { name: "Set 1: personal record, most reps at this weight" });
    expect(badge).toHaveTextContent("Rep PR");
    expect(badge).toHaveAttribute("data-pr", "reps");
  });

  it("reads PR when a rep record comes with a strength record", () => {
    render(<SetRow index={1} set={set()} state="logged" pr={["e1rm", "reps"]} />);
    const badge = screen.getByRole("img", {
      name: "Set 1: personal record, estimated one-rep max and most reps at this weight",
    });
    expect(badge.textContent).toBe("PR");
  });

  it("pops in on the spring-pop token when the record is fresh", () => {
    render(<SetRow index={1} set={set()} state="logged" pr={["weight"]} prFresh />);
    expect(screen.getByRole("img", { name: /personal record/ }).className).toContain("motion-safe:animate-spring-pop");
  });

  it("sits beside the video badge, not under it", () => {
    render(
      <SetRow index={1} set={set({ videoRequired: true, hasVideo: true })} state="logged" pr={["weight"]} />,
    );
    expect(screen.getByRole("img", { name: /personal record/ }).className).toContain("right-9");
    expect(screen.getByRole("img", { name: "Set 1: video attached" })).toBeInTheDocument();
  });

  it("never shows on a row not logged yet", () => {
    render(<SetRow index={1} set={set()} state="active" pr={["weight"]} />);
    expect(screen.queryByRole("img", { name: /personal record/ })).not.toBeInTheDocument();
  });
});

describe("the athlete's note (F11)", () => {
  const done: LoggableSet = { loadKg: 140, reps: 5, rpe: 8, isWarmup: false };

  it("puts a quiet one-line note under a logged row", () => {
    const { container } = render(<SetRow index={1} set={done} state="logged" athleteNote="  Hip pinched  " />);
    const line = container.querySelector("[data-set-note]")!;
    expect(line).toHaveTextContent("Your note: Hip pinched");
    expect(line.querySelector(".truncate")).not.toBeNull();
  });

  it("wraps the whole note when asked, as History does", () => {
    const { container } = render(<SetRow index={1} set={done} state="logged" athleteNote="A long note" athleteNoteFull />);
    expect(container.querySelector("[data-set-note] .truncate")).toBeNull();
  });

  it("shows nothing for a blank note, or on a row not logged yet", () => {
    const { container, rerender } = render(<SetRow index={1} set={done} state="logged" athleteNote="   " />);
    expect(container.querySelector("[data-set-note]")).toBeNull();
    rerender(<SetRow index={1} set={done} state="active" athleteNote="Hip pinched" />);
    expect(container.querySelector("[data-set-note]")).toBeNull();
  });
});

describe("SetRow — the clip's thumbnail (F12)", () => {
  it("shows a logged set's clip in the badge corner, in place of the coach's filmed badge", () => {
    render(
      <SetRow
        index={1}
        set={set({ videoRequired: true, hasVideo: true })}
        state="logged"
        clip={{ posterId: null }}
      />,
    );
    const thumb = screen.getByRole("img", { name: "Set 1: video attached" });
    expect(thumb).toHaveAttribute("data-clip-thumb", "placeholder");
    expect(document.querySelector("[data-video-badge]")).toBeNull();
  });

  it("is 24 x 34, absolute and centred on the border, so the row does not grow (F15)", () => {
    render(<SetRow index={1} set={set({ hasVideo: true })} state="logged" clip={{ posterId: null }} />);
    const thumb = screen.getByRole("img", { name: "Set 1: video attached" });
    for (const cls of ["absolute", "-top-3", "h-6", "w-[34px]"]) expect(thumb).toHaveClass(cls);
    expect(thumb).not.toHaveClass("h-5");
    expect(thumb).not.toHaveClass("w-7");
  });

  it("shows nothing for a set without a clip, and never on a row not logged yet", () => {
    const { rerender } = render(<SetRow index={1} set={set()} state="logged" />);
    expect(document.querySelector("[data-clip-thumb]")).toBeNull();
    rerender(<SetRow index={1} set={set()} state="active" clip={{ posterId: "x_poster" }} />);
    expect(document.querySelector("[data-clip-thumb]")).toBeNull();
  });
});

describe("SetRow — a failed set (F19)", () => {
  it("wears a Failed marker on a logged row, and no PR badge however good the numbers look", () => {
    render(<SetRow index={2} set={set({ loadKg: 200, reps: 0, failed: true })} state="logged" />);
    expect(screen.getByRole("img", { name: "Set 2: failed" })).toHaveTextContent("Failed");
    expect(screen.getByLabelText("Set 2 reps")).toHaveTextContent("0");
  });

  it("wears it on a row not logged yet too, so the switch is visibly on the right set", () => {
    render(<SetRow index={1} set={set({ reps: 0, failed: true })} state="active" onConfirm={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Set 1: failed" })).toBeInTheDocument();
    // 0 reps is a set that can be logged, because it was missed.
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();
  });

  it("does not let a made row log with 0 reps", () => {
    render(<SetRow index={1} set={set({ reps: 0 })} state="active" onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeDisabled();
    expect(screen.queryByRole("img", { name: /failed/ })).not.toBeInTheDocument();
  });

  it("keeps a set missed last time in the Previous line, marked", () => {
    render(<SetRow index={1} set={set()} state="logged" previous={{ loadKg: 200, reps: 0, failed: true }} />);
    expect(screen.getByLabelText("Set 1 last time: 200 kilograms for 0 reps, failed")).toHaveTextContent(
      "PREV 200 × 0 · failed",
    );
  });
});

describe("SetRow — 0 kg (F20)", () => {
  it("confirms a 0 kg set on a bodyweight exercise, with no hint", () => {
    const onConfirm = vi.fn();
    render(<SetRow index={1} set={set({ loadKg: 0, reps: 12, isBodyweight: true })} state="active" onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: "Log Set 1" });
    expect(confirm).toBeEnabled();
    expect(confirm).not.toHaveAccessibleDescription();
    expect(document.querySelector('[data-blocker="zero-load"]')).toBeNull();
    // 0 reads as 0, not as an empty cell.
    expect(screen.getByRole("button", { name: "Set 1 weight in kilograms" })).toHaveTextContent("0");
  });

  it("blocks 0 kg on any other exercise and says why, under the row and on the confirm", () => {
    render(<SetRow index={1} set={set({ loadKg: 0, reps: 12 })} state="active" onConfirm={() => {}} />);
    const confirm = screen.getByRole("button", { name: "Log Set 1" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription("0 kg logs only on a bodyweight exercise");
    expect(document.querySelector('[data-blocker="zero-load"]')).toHaveTextContent(
      "0 kg logs only on a bodyweight exercise",
    );
  });

  it("puts the hint in place of a suggestion's note, and only on the row the confirm belongs to", () => {
    const { rerender } = render(
      <SetRow index={1} set={set({ loadKg: 0, reps: 5 })} state="active" note="suggested from RPE 7 @ 140" />,
    );
    expect(screen.queryByText("suggested from RPE 7 @ 140")).not.toBeInTheDocument();
    rerender(<SetRow index={2} set={set({ loadKg: 0, reps: 5 })} state="planned" />);
    expect(document.querySelector('[data-blocker="zero-load"]')).toBeNull();
    rerender(<SetRow index={2} set={set({ loadKg: 0, reps: 5 })} state="logged" />);
    expect(document.querySelector('[data-blocker="zero-load"]')).toBeNull();
  });

  it("shows last time's 0 kg in the Previous line", () => {
    render(<SetRow index={1} set={set({ loadKg: null, reps: null })} state="active" previous={{ loadKg: 0, reps: 12 }} />);
    expect(screen.getByText("PREV 0 × 12")).toBeInTheDocument();
  });
});

describe("SetRow — a cardio row (F23)", () => {
  const cardio = (over: Partial<LoggableSet> = {}): LoggableSet => ({
    loadKg: 0,
    reps: 0,
    rpe: null,
    isWarmup: false,
    durationSeconds: 1230,
    level: 8,
    ...over,
  });

  it("shows the time and the level in place of weight and reps, and no RPE", () => {
    render(<SetRow index={1} set={cardio()} state="logged" cardio />);
    expect(screen.getByLabelText("Set 1 time, 20 minutes 30 seconds")).toHaveTextContent("20:30");
    expect(screen.getByLabelText("Set 1 level")).toHaveTextContent("8");
    expect(screen.queryByLabelText(/weight/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Set 1 RPE")).not.toBeInTheDocument();
  });

  it("never wears a PR, failed or camera badge, whatever it is handed", () => {
    render(
      <SetRow index={1} set={cardio({ failed: true, videoRequired: true })} state="logged" cardio pr={["reps"]} />,
    );
    expect(document.querySelector("[data-pr]")).toBeNull();
    expect(document.querySelector("[data-video-badge]")).toBeNull();
    expect(screen.queryByLabelText("Set 1: failed")).not.toBeInTheDocument();
  });

  it("logs on a time alone, and opens the pad on the time or the level", async () => {
    const onPressDuration = vi.fn();
    const onPressLevel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SetRow
        index={1}
        set={{ loadKg: null, reps: null, rpe: null, isWarmup: false, durationSeconds: 1200, level: null }}
        state="active"
        cardio
        onPressDuration={onPressDuration}
        onPressLevel={onPressLevel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("button", { name: "Set 1 level" })).toHaveTextContent("LVL");
    await userEvent.click(screen.getByRole("button", { name: "Set 1 time, 20 minutes" }));
    await userEvent.click(screen.getByRole("button", { name: "Set 1 level" }));
    expect(onPressDuration).toHaveBeenCalledTimes(1);
    expect(onPressLevel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Log Set 1" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirm dead until there is a time", () => {
    render(
      <SetRow index={1} set={{ loadKg: null, reps: null, rpe: null, isWarmup: false, level: 8 }} state="active" cardio />,
    );
    expect(screen.getByRole("button", { name: "Set 1 time" })).toHaveTextContent("MIN");
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeDisabled();
    // Its 0 kg is not the bodyweight refusal a lift would show.
    expect(document.querySelector('[data-blocker="zero-load"]')).toBeNull();
  });

  it("shows last time's cardio on the Previous line, and never a strength set there", () => {
    const { unmount } = render(
      <SetRow
        index={1}
        set={cardio()}
        state="logged"
        cardio
        previous={{ loadKg: 0, reps: 0, durationSeconds: 1200, level: 7 }}
      />,
    );
    expect(screen.getByLabelText("Set 1 last time: 20 minutes, level 7")).toHaveTextContent("PREV 20 min · level 7");
    unmount();
    render(<SetRow index={1} set={cardio()} state="logged" cardio previous={{ loadKg: 100, reps: 5 }} />);
    expect(document.querySelector("[data-previous]")).toBeNull();
  });

  it("heads its columns MIN and LEVEL", () => {
    render(<SetRowHeader cardio />);
    expect(screen.getByText("MIN")).toBeInTheDocument();
    expect(screen.getByText("LEVEL")).toBeInTheDocument();
    expect(screen.queryByText("RPE")).not.toBeInTheDocument();
  });
});
