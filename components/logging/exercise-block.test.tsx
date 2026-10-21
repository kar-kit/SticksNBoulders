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
