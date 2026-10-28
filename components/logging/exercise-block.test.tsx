import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseBlock, type LoggedSet, type PlannedSet } from "./exercise-block";

const logged = (id: string, over: Partial<LoggedSet> = {}): LoggedSet => ({
  clientSetId: id,
  loadKg: 140,
  reps: 5,
  rpe: 8,
  isWarmup: false,
  ...over,
});

const row = (id: string, over: Partial<PlannedSet> = {}): PlannedSet => ({
  clientSetId: id,
  loadKg: 140,
  reps: 5,
  rpe: null,
  isWarmup: false,
  ...over,
});

describe("ExerciseBlock — the header's remove", () => {
  it("is an icon with a label, not the word Remove", () => {
    render(<ExerciseBlock name="Squat" sets={[]} planned={[row("p1")]} onRemove={() => {}} />);
    const remove = screen.getByRole("button", { name: "Remove Squat from this session" });
    expect(remove.querySelector("svg")).not.toBeNull();
    expect(remove).not.toHaveTextContent("Remove");
  });

  it("still asks first when there is logged work to lose", async () => {
    const onRemove = vi.fn();
    render(<ExerciseBlock name="Squat" sets={[logged("a"), logged("b")]} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    expect(onRemove).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: "Remove Squat?" });
    expect(confirm).toHaveTextContent("Its 2 logged sets will be deleted.");
    // The icon steps aside while the question is open.
    expect(screen.queryByRole("button", { name: "Remove Squat from this session" })).not.toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove exercise" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("goes straight to the screen's undo when nothing is logged", async () => {
    const onRemove = vi.fn();
    render(<ExerciseBlock name="Squat" sets={[]} planned={[row("p1")]} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("Keep closes the question and brings the icon back", async () => {
    render(<ExerciseBlock name="Squat" sets={[logged("a")]} onRemove={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByRole("button", { name: "Remove Squat from this session" })).toBeInTheDocument();
  });
});

describe("ExerciseBlock — rows", () => {
  it("shows no per-row remove buttons, only the hidden accessible ones", () => {
    render(
      <ExerciseBlock name="Squat" sets={[]} planned={[row("p1"), row("p2"), row("p3")]} onDiscard={() => {}} />,
    );
    expect(screen.queryByText("×")).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /Remove planned/ })) {
      expect(button).toHaveClass("sr-only");
    }
  });

  it("discards the row that was swiped, by its id", () => {
    const onDiscard = vi.fn();
    render(<ExerciseBlock name="Squat" sets={[]} planned={[row("p1"), row("p2")]} onDiscard={onDiscard} />);
    const second = screen.getByRole("group", { name: "Set 2" });
    fireEvent.pointerDown(second, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(second, { clientX: 150, clientY: 10 });
    fireEvent.pointerUp(second);
    expect(onDiscard).toHaveBeenCalledWith("p2");
  });

  it("routes the warm-up toggle by id, for logged sets and rows not logged yet", async () => {
    const onToggleWarmup = vi.fn();
    render(
      <ExerciseBlock
        name="Squat"
        sets={[logged("a")]}
        planned={[row("p1")]}
        onToggleWarmup={onToggleWarmup}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));
    await userEvent.click(screen.getByRole("button", { name: "Set 2: mark as warm-up" }));
    expect(onToggleWarmup.mock.calls).toEqual([["a"], ["p1"]]);
  });

  it("numbers working sets only, so a flipped set renumbers the rest", () => {
    const { rerender } = render(
      <ExerciseBlock name="Squat" sets={[logged("a"), logged("b")]} planned={[row("p1")]} onToggleWarmup={() => {}} />,
    );
    expect(screen.getByRole("group", { name: "Set 3" })).toBeInTheDocument();
    rerender(
      <ExerciseBlock
        name="Squat"
        sets={[logged("a", { isWarmup: true, rpe: null }), logged("b")]}
        planned={[row("p1")]}
        onToggleWarmup={() => {}}
      />,
    );
    expect(screen.getByRole("group", { name: "Warm-up set" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(screen.getByRole("group", { name: "Set 2" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Set 3" })).not.toBeInTheDocument();
  });
});

describe("ExerciseBlock — swap variant (F5)", () => {
  it("offers Swap only when the screen has variants to give", async () => {
    const onSwap = vi.fn();
    const { rerender } = render(<ExerciseBlock name="Barbell Row" sets={[]} planned={[row("p1")]} />);
    expect(screen.queryByRole("button", { name: "Swap variant of Barbell Row" })).not.toBeInTheDocument();
    rerender(<ExerciseBlock name="Barbell Row" sets={[]} planned={[row("p1")]} onSwap={onSwap} />);
    await userEvent.click(screen.getByRole("button", { name: "Swap variant of Barbell Row" }));
    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it("offers it on a block with nothing logged or planned yet, so the swap can come first", () => {
    render(<ExerciseBlock name="Cable Front Raise" sets={[]} onSwap={() => {}} />);
    expect(screen.getByRole("button", { name: "Swap variant of Cable Front Raise" })).toBeInTheDocument();
  });

  it("says what the coach wrote once the block is on another variant", () => {
    render(<ExerciseBlock name="Dumbbell Row" sets={[]} planned={[row("p1")]} prescribedAs="Barbell Row" />);
    expect(screen.getByRole("region", { name: "Dumbbell Row" })).toHaveTextContent("Coach’s pick: Barbell Row");
  });
});

describe("ExerciseBlock — rows arriving (F5)", () => {
  const arrivedIds = () =>
    [...document.querySelectorAll("[data-arrived]")].map(
      (el) => el.querySelector('[role="group"]')?.getAttribute("aria-label"),
    );

  it("does not slide in the rows that were there on first render", () => {
    render(<ExerciseBlock name="Squat" sets={[]} planned={[row("p1"), row("p2")]} />);
    expect(arrivedIds()).toEqual([]);
  });

  it("slides in every row laid out at once when the block opens", () => {
    const { rerender } = render(<ExerciseBlock name="Squat" sets={[]} planned={[]} />);
    rerender(
      <ExerciseBlock
        name="Squat"
        sets={[]}
        planned={[row("w", { isWarmup: true, loadKg: null, reps: null }), row("p1"), row("p2")]}
      />,
    );
    expect(arrivedIds()).toEqual(["Warm-up set", "Set 1", "Set 2"]);
  });

  it("slides in only the row Add set brought", () => {
    const { rerender } = render(<ExerciseBlock name="Squat" sets={[]} planned={[row("p1")]} />);
    rerender(<ExerciseBlock name="Squat" sets={[]} planned={[row("p1"), row("p2")]} />);
    expect(arrivedIds()).toEqual(["Set 2"]);
  });

  it("never slides in logged sets read back after a reload", () => {
    const { rerender } = render(<ExerciseBlock name="Squat" sets={[]} />);
    rerender(<ExerciseBlock name="Squat" sets={[logged("a"), logged("b")]} />);
    expect(arrivedIds()).toEqual([]);
  });
});

describe("ExerciseBlock — the coach's video ask (F5)", () => {
  it("badges the planned rows the coach wants filmed, and the logged one still waiting for its clip", () => {
    render(
      <ExerciseBlock
        name="Squat"
        sets={[logged("a", { videoRequired: true }), logged("b", { videoRequired: true, hasVideo: true })]}
        planned={[row("p1", { videoRequired: true }), row("p2")]}
      />,
    );
    expect(screen.getByRole("img", { name: "Set 1: your coach asked for a video, not filmed yet" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Set 2: video attached" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Set 3: your coach asked for a video" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Set 4/ })).not.toBeInTheDocument();
    // A badge, not a gate: the head row can still be logged.
    expect(screen.getByRole("button", { name: "Log Set 3" })).toBeEnabled();
  });
});

describe("ExerciseBlock — last time, records and history (F6)", () => {
  it("links to the exercise's history beside the name, leaving the name to reopen the block", () => {
    const onActivate = vi.fn();
    render(<ExerciseBlock name="Squat" sets={[logged("a")]} onActivate={onActivate} historyHref="/lift/squat" />);
    expect(screen.getByRole("link", { name: "Squat history and records" })).toHaveAttribute("href", "/lift/squat");
    fireEvent.click(screen.getByRole("button", { name: "Squat" }));
    expect(onActivate).toHaveBeenCalled();
  });

  it("draws the lift link as a chart, not the History tab's clock", () => {
    render(<ExerciseBlock name="Squat" sets={[logged("a")]} historyHref="/lift/squat" />);
    const svg = screen.getByRole("link", { name: "Squat history and records" }).querySelector("svg");
    expect(svg?.querySelector("circle")).toBeNull();
    expect(svg?.querySelector("path")).not.toBeNull();
  });

  it("has no history link when none is given", () => {
    render(<ExerciseBlock name="Squat" sets={[logged("a")]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("hands each row its own last time, and copies only into rows not logged yet", async () => {
    const onCopyPrevious = vi.fn();
    render(
      <ExerciseBlock
        name="Squat"
        sets={[logged("a", { previous: { loadKg: 135, reps: 5 }, pr: ["weight"] })]}
        planned={[row("p1", { previous: { loadKg: 140, reps: 5 } }), row("p2")]}
        onCopyPrevious={onCopyPrevious}
      />,
    );
    expect(screen.getByLabelText("Set 1 last time: 135 kilograms for 5 reps")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Set 1: personal record, heaviest weight" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set 2: use last time, 140 kilograms for 5 reps" }));
    expect(onCopyPrevious).toHaveBeenCalledWith("p1");
    // Set 3 has no last time: no line, no button.
    expect(screen.queryAllByRole("button", { name: /use last time/ })).toHaveLength(1);
  });
});

describe("ExerciseBlock — a bodyweight exercise (F20)", () => {
  it("lends the flag to its rows, so the head confirms at 0 kg", () => {
    render(<ExerciseBlock name="Pull Up" sets={[]} planned={[row("p1", { loadKg: 0, reps: 10 })]} isBodyweight />);
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();
  });

  it("leaves 0 kg refused on an exercise without it", () => {
    render(<ExerciseBlock name="Squat" sets={[]} planned={[row("p1", { loadKg: 0, reps: 10 })]} />);
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeDisabled();
  });
});

describe("ExerciseBlock — a cardio exercise (F23)", () => {
  it("asks its rows for a time and a level, and logs one on a time alone", () => {
    render(
      <ExerciseBlock
        name="Stairmaster"
        sets={[]}
        planned={[row("p1", { loadKg: null, reps: null, durationSeconds: 900 })]}
        isCardio
        historyHref="/lift/stairs"
      />,
    );
    expect(screen.getByText("MIN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set 1 time, 15 minutes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();
    // Lift Detail is records and e1RM, neither of which cardio has.
    expect(screen.queryByRole("link", { name: /history and records/ })).not.toBeInTheDocument();
  });

  it("opens the pad on the field tapped", async () => {
    const onFocus = vi.fn();
    render(
      <ExerciseBlock name="Bike" sets={[]} planned={[row("p1", { loadKg: null, reps: null })]} isCardio onFocus={onFocus} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Set 1 time" }));
    await userEvent.click(screen.getByRole("button", { name: "Set 1 level" }));
    expect(onFocus.mock.calls).toEqual([
      ["p1", "duration"],
      ["p1", "level"],
    ]);
  });

  it("draws its logged sets as cardio, with no camera and no warm-up switch", () => {
    render(
      <ExerciseBlock
        name="Bike"
        sets={[logged("s1", { loadKg: 0, reps: 0, rpe: null, durationSeconds: 1200, level: 8 })]}
        isCardio
        camera={<button type="button">Film</button>}
        onToggleWarmup={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Set 1 time, 20 minutes")).toHaveTextContent("20");
    expect(screen.queryByRole("button", { name: "Film" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark as warm-up/ })).not.toBeInTheDocument();
  });

  it("still draws a strength set logged before the exercise was made cardio as a lift", () => {
    render(<ExerciseBlock name="Bike" sets={[logged("s1", { loadKg: 100, reps: 5 })]} isCardio />);
    expect(screen.getByLabelText("Set 1 weight in kilograms")).toHaveTextContent("100");
  });
});
