import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditSetSheet, type EditSetSheetProps } from "./edit-set-sheet";
import { beginEdit } from "@/lib/logging/number-pad";

function setup(overrides: Partial<EditSetSheetProps> = {}) {
  const props: EditSetSheetProps = {
    setLabel: "Set 2",
    exerciseName: "Squat",
    draft: { loadKg: 140, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "" },
    field: "load",
    pad: beginEdit("load", 140, "kg"),
    unit: "kg",
    canSave: true,
    onField: vi.fn(),
    onPadChange: vi.fn(),
    onToggleWarmup: vi.fn(),
    onRpe: vi.fn(),
    onToggleFailed: vi.fn(),
    onNote: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<EditSetSheet {...props} />);
  return { props, user: userEvent.setup() };
}

describe("EditSetSheet", () => {
  it("says which set it is editing, and offers Cancel and Save rather than Done or a confirm", () => {
    setup();
    const sheet = screen.getByRole("region", { name: "Edit Set 2" });
    expect(within(sheet).getByRole("heading", { name: "Edit set 2" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Squat · logged");
    expect(screen.getByRole("button", { name: "Cancel, keep Set 2 as logged" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Set 2" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("titles a warm-up as one", () => {
    setup({ setLabel: "Warm-up set", draft: { loadKg: 60, reps: 5, rpe: null, isWarmup: true, failed: false, notes: "" } });
    expect(screen.getByRole("heading", { name: "Edit warm-up" })).toBeInTheDocument();
    // Never asked for RPE, so the field cannot be opened, and Next on reps saves.
    expect(screen.getByRole("button", { name: "Change RPE, now none, warm-up" })).toBeDisabled();
  });

  it("shows the values in the athlete's unit", () => {
    setup({ unit: "lb", pad: beginEdit("load", 308.6, "lb") });
    expect(screen.getByRole("button", { name: "Change weight, now 308.6 pounds" })).toBeInTheDocument();
  });

  it("moves between fields from the values strip and the pad's Next", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Change RPE, now 8" }));
    expect(props.onField).toHaveBeenCalledWith("rpe");
    await user.click(screen.getByRole("button", { name: "Reps" }));
    expect(props.onField).toHaveBeenCalledWith("reps");
  });

  it("saves from the pad's Next on the last field of a warm-up", async () => {
    const { props, user } = setup({
      setLabel: "Warm-up set",
      draft: { loadKg: 60, reps: 5, rpe: null, isWarmup: true, failed: false, notes: "" },
      field: "reps",
      pad: beginEdit("reps", 5),
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("puts the RPE chips in place of the pad on the RPE field", async () => {
    const { props, user } = setup({ field: "rpe", pad: null });
    expect(screen.queryByRole("region", { name: /keypad/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "9" }));
    expect(props.onRpe).toHaveBeenCalledWith(9);
  });

  it("holds Save back for a draft that is not a set", () => {
    setup({ canSave: false, draft: { loadKg: null, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "" } });
    expect(screen.getByRole("button", { name: "Save Set 2" })).toBeDisabled();
  });

  it("keeps the non-gesture Delete, or says why there is none", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Delete Set 2" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("shows why a set cannot be deleted in place of Delete", () => {
    setup({ deleteBlocked: "Your coach has commented on this set, so it stays." });
    expect(screen.getByText(/Your coach has commented/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Set 2" })).not.toBeInTheDocument();
  });

  describe("the note (F11)", () => {
    it("offers to add a note when there is none, and opens the note field", async () => {
      const { props, user } = setup();
      await user.click(screen.getByRole("button", { name: "Add a note to Set 2" }));
      expect(props.onField).toHaveBeenCalledWith("note");
    });

    it("shows the note as it stands on the cell", () => {
      setup({ draft: { loadKg: 140, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "Hip pinched" } });
      expect(screen.getByRole("button", { name: "Change note, now: Hip pinched" })).toHaveTextContent("Hip pinched");
    });

    it("swaps the pad for a textarea on the note field and reports what is typed", async () => {
      const { props, user } = setup({ field: "note", pad: null });
      expect(screen.queryByRole("button", { name: "Reps" })).not.toBeInTheDocument();
      const box = screen.getByRole("textbox", { name: "Note on Set 2" });
      expect(box).toHaveFocus();
      expect(box).toHaveAttribute("maxLength", "500");
      await user.type(box, "B");
      expect(props.onNote).toHaveBeenCalledWith("B");
    });

    it("counts down only near the 500-character limit", () => {
      setup({ field: "note", pad: null, draft: { loadKg: 140, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "x".repeat(460) } });
      expect(screen.getByText("40 left")).toBeInTheDocument();
    });

    it("shows no counter on a short note", () => {
      setup({ field: "note", pad: null, draft: { loadKg: 140, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "felt slow" } });
      expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
    });
  });

  describe("the set's clip (F17)", () => {
    it("shows the camera it is given in a Video row, saying it does not wait for Save", () => {
      setup({ video: <button type="button">Replace video</button> });
      const row = screen.getByRole("group", { name: "Video" });
      expect(within(row).getByRole("button", { name: "Replace video" })).toBeInTheDocument();
      expect(row).toHaveTextContent("Goes up straight away, not on Save.");
    });

    it("has no Video row without one", () => {
      setup();
      expect(screen.queryByRole("group", { name: "Video" })).not.toBeInTheDocument();
    });

    it("holds Delete back while told to", () => {
      setup({ deleteDisabled: true });
      expect(screen.getByRole("button", { name: "Delete Set 2" })).toBeDisabled();
    });
  });
});

describe("EditSetSheet's Failed switch (F19)", () => {
  it("is on the pad and reports a flip", async () => {
    const { props, user } = setup({ field: "reps", pad: beginEdit("reps", 5) });
    const toggle = screen.getByRole("switch", { name: "Failed" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(props.onToggleFailed).toHaveBeenCalledWith(true);
  });

  it("is under the RPE chips too, and on for a failed draft", () => {
    setup({ field: "rpe", pad: null, draft: { loadKg: 200, reps: 0, rpe: 10, isWarmup: false, failed: true, notes: "" } });
    expect(screen.getByRole("switch", { name: "Failed" })).toHaveAttribute("aria-checked", "true");
  });

  it("says FAILED on the reps cell of a failed draft, aloud as well", () => {
    setup({ draft: { loadKg: 200, reps: 0, rpe: 10, isWarmup: false, failed: true, notes: "" } });
    expect(screen.getByRole("button", { name: "Change reps, now 0, failed set" })).toHaveTextContent("REPS · FAILED");
  });
});

describe("EditSetSheet — Save blocked at 0 kg (F20)", () => {
  it("says why Save is off, and describes the button with it", () => {
    setup({
      canSave: false,
      saveBlocked: "0 kg logs only on a bodyweight exercise",
      draft: { loadKg: 0, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "" },
    });
    const save = screen.getByRole("button", { name: "Save Set 2" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("0 kg logs only on a bodyweight exercise");
  });

  it("says nothing when nothing is blocking", () => {
    setup({ draft: { loadKg: 0, reps: 12, rpe: 8, isWarmup: false, failed: false, notes: "" } });
    expect(screen.getByRole("button", { name: "Save Set 2" })).not.toHaveAccessibleDescription();
    expect(document.querySelector("[data-blocker]")).toBeNull();
  });
});
