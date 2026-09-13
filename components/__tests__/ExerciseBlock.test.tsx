import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExerciseBlock from "../ExerciseBlock";
import type { WorkoutSet } from "@/lib/types";

function makeSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    $id: "s-" + Math.random(),
    $sequence: "0",
    $tableId: "workout_sets",
    $databaseId: "sticksnboulders",
    $createdAt: "",
    $updatedAt: "",
    $permissions: [],
    userId: "u1",
    sessionId: "sess1",
    liftId: "squat",
    date: "2026-01-01T00:00:00.000Z",
    weightKg: 100,
    reps: 5,
    isWarmup: false,
    ...overrides,
  };
}

describe("ExerciseBlock", () => {
  it("renders the lift name", () => {
    render(
      <ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={jest.fn()} />
    );
    expect(screen.getByText("Squat")).toBeInTheDocument();
  });

  it("renders no set rows when there are no sets yet", () => {
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={jest.fn()} />);
    expect(screen.queryByText(/Set 1/)).not.toBeInTheDocument();
  });

  it("renders each set with its weight and reps in the selected unit", () => {
    render(
      <ExerciseBlock
        liftName="Squat"
        sets={[makeSet({ weightKg: 100, reps: 5 })]}
        unitPreference="kg"
        onAddSet={jest.fn()}
      />
    );
    expect(screen.getByText("Set 1")).toBeInTheDocument();
    expect(screen.getByText("100 kg × 5")).toBeInTheDocument();
  });

  it("converts weight for a lb-preferring user", () => {
    render(
      <ExerciseBlock
        liftName="Squat"
        sets={[makeSet({ weightKg: 100, reps: 5 })]}
        unitPreference="lb"
        onAddSet={jest.fn()}
      />
    );
    expect(screen.getByText("220.5 lb × 5")).toBeInTheDocument();
  });

  it("labels a warm-up set distinctly", () => {
    render(
      <ExerciseBlock
        liftName="Squat"
        sets={[makeSet({ isWarmup: true })]}
        unitPreference="kg"
        onAddSet={jest.fn()}
      />
    );
    expect(screen.getByText(/Set 1 · warm-up/)).toBeInTheDocument();
  });

  it("calls onAddSet with parsed numeric weight/reps and isWarmup=false by default", async () => {
    const onAddSet = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={onAddSet} />);

    await user.type(screen.getByPlaceholderText("Weight (kg)"), "102.5");
    await user.type(screen.getByPlaceholderText("Reps"), "5");
    await user.click(screen.getByRole("button", { name: "Add Set" }));

    expect(onAddSet).toHaveBeenCalledWith(102.5, 5, false);
  });

  it("passes isWarmup=true when the warm-up toggle is checked", async () => {
    const onAddSet = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={onAddSet} />);

    await user.type(screen.getByPlaceholderText("Weight (kg)"), "40");
    await user.type(screen.getByPlaceholderText("Reps"), "10");
    await user.click(screen.getByText("Warm-up"));
    await user.click(screen.getByRole("button", { name: "Add Set" }));

    expect(onAddSet).toHaveBeenCalledWith(40, 10, true);
  });

  it("does not call onAddSet when weight is empty", async () => {
    const onAddSet = jest.fn();
    const user = userEvent.setup();
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={onAddSet} />);

    await user.type(screen.getByPlaceholderText("Reps"), "5");
    await user.click(screen.getByRole("button", { name: "Add Set" }));

    expect(onAddSet).not.toHaveBeenCalled();
  });

  it("does not call onAddSet when reps is empty", async () => {
    const onAddSet = jest.fn();
    const user = userEvent.setup();
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={onAddSet} />);

    await user.type(screen.getByPlaceholderText("Weight (kg)"), "100");
    await user.click(screen.getByRole("button", { name: "Add Set" }));

    expect(onAddSet).not.toHaveBeenCalled();
  });

  it("does not call onAddSet when reps is 0", async () => {
    const onAddSet = jest.fn();
    const user = userEvent.setup();
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={onAddSet} />);

    await user.type(screen.getByPlaceholderText("Weight (kg)"), "100");
    await user.type(screen.getByPlaceholderText("Reps"), "0");
    await user.click(screen.getByRole("button", { name: "Add Set" }));

    expect(onAddSet).not.toHaveBeenCalled();
  });

  it("does not call onAddSet for non-numeric weight input", async () => {
    const onAddSet = jest.fn();
    const user = userEvent.setup();
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={onAddSet} />);

    await user.type(screen.getByPlaceholderText("Weight (kg)"), "abc");
    await user.type(screen.getByPlaceholderText("Reps"), "5");
    await user.click(screen.getByRole("button", { name: "Add Set" }));

    expect(onAddSet).not.toHaveBeenCalled();
  });

  it("clears the reps input and warm-up toggle after a successful add, but keeps weight", async () => {
    const onAddSet = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ExerciseBlock liftName="Squat" sets={[]} unitPreference="kg" onAddSet={onAddSet} />);

    const weightInput = screen.getByPlaceholderText("Weight (kg)") as HTMLInputElement;
    const repsInput = screen.getByPlaceholderText("Reps") as HTMLInputElement;

    await user.type(weightInput, "100");
    await user.type(repsInput, "5");
    await user.click(screen.getByRole("button", { name: "Add Set" }));

    expect(repsInput.value).toBe("");
    expect(weightInput.value).toBe("100");
  });
});
