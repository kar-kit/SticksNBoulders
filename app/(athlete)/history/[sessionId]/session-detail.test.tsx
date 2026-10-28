import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionDetail } from "./session-detail";
import type { SessionRecord } from "@/lib/logging/session";
import type { Exercise } from "@/lib/exercises/match";
import type { HistorySet } from "@/lib/logging/history-store";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } },
    refresh: vi.fn(),
  }),
}));

const library = vi.hoisted(() => ({ exercises: [] as Exercise[] }));
vi.mock("@/lib/exercises/library-context", () => ({
  useExerciseLibrary: () => ({
    state: { status: "ready", exercises: library.exercises },
    remember: vi.fn(),
    reload: vi.fn(),
  }),
}));

const training = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/logging/session-context", () => ({
  useTrainingSessions: () => training.value,
}));

const loaded = vi.hoisted(() => ({ sets: [] as unknown[], fail: false }));
vi.mock("@/lib/logging/history-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/history-store")>()),
  fetchSetsForSessions: async () => {
    if (loaded.fail) throw new TypeError("Failed to fetch");
    return loaded.sets;
  },
}));

const editSet = vi.hoisted(() =>
  vi.fn<(id: string, edit: Record<string, unknown>, set: Record<string, unknown>) => Promise<void>>(),
);
const removeSet = vi.hoisted(() =>
  vi.fn<(id: string, set?: Record<string, unknown>) => Promise<void>>(),
);
vi.mock("@/lib/logging/set-store", () => ({ editSet, removeSet }));

const sessionEdits = vi.hoisted(() => ({
  reviseSession: vi.fn(async () => {}),
  reviseSessionTotals: vi.fn(async () => {}),
  checkSessionDeletable: vi.fn(async (): Promise<{ ok: true } | { ok: false; reason: string; message: string }> => ({
    ok: true,
  })),
  deleteSessionAndSets: vi.fn(async () => ({ queued: true })),
}));
vi.mock("@/lib/logging/session-edit-store", () => sessionEdits);

const patch = vi.fn();
const drop = vi.fn();

// The real row, with a hand on the active row's confirm. The button is
// disabled for an incomplete draft, so the only way to reach save() with one
// is a handler that fires anyway -- which is what the guard inside it is for.
const activeConfirm = vi.hoisted(() => ({ current: undefined as (() => void) | undefined }));
vi.mock("@/components/logging/set-row", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/logging/set-row")>();
  return {
    ...real,
    SetRow: (props: Parameters<typeof real.SetRow>[0]) => {
      if (props.state === "active") activeConfirm.current = props.onConfirm;
      return <real.SetRow {...props} />;
    },
  };
});

// The athlete's unit. Kilos unless a test says otherwise.
const units = vi.hoisted(() => ({ unit: "kg" as "kg" | "lb" }));
vi.mock("@/lib/profile/units-context", () => ({
  useUnits: () => ({ unit: units.unit, setUnit: vi.fn() }),
}));

const session: SessionRecord = {
  id: "s1",
  clientSessionId: "s1",
  startedAt: new Date("2026-09-14T09:00:00Z"),
  finishedAt: new Date("2026-09-14T10:12:00Z"),
  setCount: 2,
  tonnageKg: 1400,
  notes: null,
};

const set = (over: Partial<HistorySet> = {}): HistorySet => ({
  sessionId: "s1",
  exerciseId: "squat",
  clientSetId: "st-1",
  setIndex: 1,
  loadKg: 140,
  reps: 5,
  rpe: 8,
  isWarmup: false,
  e1rmKg: 168,
  loggedAt: new Date("2026-09-14T09:30:00Z"),
  ...over,
});

function setup(over: Partial<SessionRecord> = {}) {
  training.value = {
    state: { status: "ready", sessions: [{ ...session, ...over }] },
    active: null,
    lastFinished: null,
    start: vi.fn(),
    finish: vi.fn(),
    patch,
    drop,
    reload: vi.fn(),
  };
  render(<SessionDetail sessionId="s1" />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  loaded.fail = false;
  activeConfirm.current = undefined;
  units.unit = "kg";
  editSet.mockResolvedValue(undefined);
  removeSet.mockResolvedValue(undefined);
  library.exercises = [{ id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true }];
  loaded.sets = [
    set({ clientSetId: "st-w", loadKg: 60, isWarmup: true, rpe: null, e1rmKg: null }),
    set({ clientSetId: "st-1" }),
    set({ clientSetId: "st-2", setIndex: 2, loadKg: 150, reps: 3, rpe: 9 }),
  ];
});

describe("reading a past session", () => {
  it("shows every set as it was logged, under its exercise", async () => {
    setup();
    expect(await screen.findByRole("region", { name: "Squat" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Warm-up set" })).toHaveTextContent("60");
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
  });

  it("numbers working sets and leaves warm-ups as W", async () => {
    setup();
    await screen.findByRole("region", { name: "Squat" });
    // A warm-up first means Set 1 is still the first working set, which is what
    // the athlete and the coach both mean by set 1.
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
  });
});

describe("correcting a set", () => {
  it("opens the same row the logger uses, ready to edit", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    // The number pad, not a keyboard -- the same gesture as logging it.
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("writes the correction with every value, so e1RM can be recomputed", async () => {
    // The Order 11 gap: a partial update cannot recompute the estimate, so an
    // edit that changed reps would leave last week's number on the row.
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));

    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    for (const key of ["1", "4", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][0]).toBe("st-1");
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 145, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: null });
    // And the exercise and the set's own logged time, so the rollup for the
    // week it was logged in is recomputed, not this week's.
    expect(editSet.mock.calls[0][2]).toEqual({ exerciseId: "squat", loggedAt: new Date("2026-09-14T09:30:00Z") });
  });

  it("shows the correction immediately rather than waiting for the write", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    // Three presses clears "140" from the field.
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    for (const key of ["1", "4", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("145"));
  });

  it("can mark a set as a warm-up after the fact", async () => {
    // Which removes it from the week's tonnage, hence the rollup refresh.
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("switch", { name: "Warm-up" }));
    await user.click(screen.getByRole("button", { name: /^Log Warm-up set$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalled());
    expect(editSet.mock.calls[0][1]).toMatchObject({ isWarmup: true, rpe: null });
  });

  it("leaves the set alone when the edit is cancelled", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(editSet).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
  });

  it("deletes a set, and tells the rollup which week lost one", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Delete set" }));

    await waitFor(() => expect(removeSet).toHaveBeenCalledWith("st-1", {
      exerciseId: "squat",
      loggedAt: new Date("2026-09-14T09:30:00Z"),
      videoFileId: null,
    }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("150"));
  });

  it("will not save a draft with no weight, even if its confirm fires", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));

    const confirm = screen.getByRole("button", { name: /^Log Set 1$/ });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    // A stale handler, as a double tap racing a re-render would fire.
    await act(async () => activeConfirm.current?.());

    // A null load written over a real set would wipe its tonnage and its e1RM.
    expect(editSet).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete set" })).toBeInTheDocument();
  });

  it("puts the server's copy back when a correction cannot be written", async () => {
    // Only the device's own storage failing gets here. The correction exists
    // nowhere, so the screen must stop showing it.
    editSet.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    for (const key of ["1", "4", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140"));
    expect(screen.getByRole("group", { name: "Set 1" })).not.toHaveTextContent("145");
  });

  it("puts a set back when its delete cannot be written", async () => {
    removeSet.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Delete set" }));

    await waitFor(() => expect(removeSet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150"));
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
  });
});

describe("for an athlete who reads pounds", () => {
  beforeEach(() => {
    units.unit = "lb";
  });

  it("shows the logged kilos in pounds", async () => {
    setup();
    expect(await screen.findByRole("group", { name: "Set 1" })).toHaveTextContent("308.6");
    expect(screen.getAllByText("LB").length).toBeGreaterThan(0);
  });

  it("takes a correction typed in pounds and writes it as kilos", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    expect(screen.getByRole("status")).toHaveTextContent("308.6");
    // "308.6" on the pad: five presses clear it.
    for (let i = 0; i < 5; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    for (const key of ["3", "1", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 142.882, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: null });
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("315");
  });
});

describe("the session's stored totals", () => {
  // The bug: History cards read set_count and tonnage_kg off the session row,
  // which only finishSession ever wrote. Correcting or deleting a set here
  // left the card showing finish-time numbers for good.
  it("are restated after a correction, from the sets as they now are", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    for (const key of ["1", "4", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    // 145 x 5 + 150 x 3. The warm-up counts toward neither, as at finish.
    const totals = { setCount: 2, tonnageKg: 1175 };
    await waitFor(() => expect(sessionEdits.reviseSessionTotals).toHaveBeenCalledWith("s1", totals));
    expect(patch).toHaveBeenCalledWith("s1", totals);
    // Behind the set's own write, so the totals land after the change they describe.
    expect(editSet.mock.invocationCallOrder[0]).toBeLessThan(
      sessionEdits.reviseSessionTotals.mock.invocationCallOrder[0],
    );
  });

  it("are restated after a delete", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Delete set" }));
    await waitFor(() =>
      expect(sessionEdits.reviseSessionTotals).toHaveBeenCalledWith("s1", { setCount: 1, tonnageKg: 450 }),
    );
  });

  it("are left alone when they already match", async () => {
    // Marking set 2 a warm-up and back again is no change at all.
    const { user } = setup({ setCount: 2, tonnageKg: 1150 });
    await user.click(await screen.findByRole("button", { name: "Edit set 2 of Squat" }));
    await user.click(screen.getByRole("button", { name: /^Log Set 2$/ }));
    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(sessionEdits.reviseSessionTotals).not.toHaveBeenCalled();
  });
});

describe("a set's clip", () => {
  it("goes with the set when it is deleted from History", async () => {
    loaded.sets = [set({ clientSetId: "st-1", videoFileId: "vid-1" })];
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Delete set" }));
    await waitFor(() =>
      expect(removeSet).toHaveBeenCalledWith("st-1", expect.objectContaining({ videoFileId: "vid-1" })),
    );
  });
});

describe("naming a session", () => {
  it("titles it by its name, with the date underneath", async () => {
    setup({ name: "Heavy singles" });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Heavy singles");
    expect(screen.getByText(/Monday 14 Sep ·/)).toBeInTheDocument();
  });

  it("saves a name and notes, and shows them at once", async () => {
    const { user } = setup();
    await screen.findByRole("region", { name: "Squat" });
    await user.click(screen.getByRole("button", { name: "Edit name and notes" }));
    // Blank shows what it would be called without one.
    expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "Monday 14 Sep");
    await user.type(screen.getByLabelText("Name"), "  Heavy singles ");
    await user.type(screen.getByLabelText("Notes"), "Knees felt good");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const change = { name: "Heavy singles", notes: "Knees felt good" };
    expect(patch).toHaveBeenCalledWith("s1", change);
    await waitFor(() => expect(sessionEdits.reviseSession).toHaveBeenCalledWith("s1", change));
  });

  it("clears a name back to the default when it is emptied", async () => {
    const { user } = setup({ name: "Old name" });
    await screen.findByRole("region", { name: "Squat" });
    await user.click(screen.getByRole("button", { name: "Edit name and notes" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sessionEdits.reviseSession).toHaveBeenCalledWith("s1", { name: null, notes: null }));
  });

  it("puts the old name back when the change cannot be written", async () => {
    sessionEdits.reviseSession.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    const { user } = setup({ name: "Old name" });
    await screen.findByRole("region", { name: "Squat" });
    await user.click(screen.getByRole("button", { name: "Edit name and notes" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "New name");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith("s1", { name: "Old name", notes: null }));
    expect(screen.getByRole("status")).toHaveTextContent("wasn't saved");
  });
});

describe("deleting a whole session", () => {
  it("asks first, then deletes every set in it and leaves for History", async () => {
    const { user } = setup();
    await screen.findByRole("region", { name: "Squat" });
    await user.click(screen.getByRole("button", { name: "Delete session" }));
    expect(screen.getByRole("alert")).toHaveTextContent("all 3 sets");
    expect(sessionEdits.deleteSessionAndSets).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete session" }));
    await waitFor(() => expect(sessionEdits.deleteSessionAndSets).toHaveBeenCalledTimes(1));
    expect(sessionEdits.checkSessionDeletable).toHaveBeenCalledWith("joey", ["st-w", "st-1", "st-2"]);
    const [id, sets] = sessionEdits.deleteSessionAndSets.mock.calls[0] as unknown as [string, HistorySet[]];
    expect(id).toBe("s1");
    expect(sets.map((each) => each.clientSetId)).toEqual(["st-w", "st-1", "st-2"]);
    expect(drop).toHaveBeenCalledWith("s1");
    expect(push).toHaveBeenCalledWith("/history");
  });

  it("keeps it, and says why, when the coach has commented on it", async () => {
    sessionEdits.checkSessionDeletable.mockResolvedValueOnce({
      ok: false,
      reason: "coach-feedback",
      message: "Your coach has commented on this session, so it stays.",
    });
    const { user } = setup();
    await screen.findByRole("region", { name: "Squat" });
    await user.click(screen.getByRole("button", { name: "Delete session" }));
    await user.click(screen.getByRole("button", { name: "Delete session" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Your coach has commented");
    expect(sessionEdits.deleteSessionAndSets).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("will not delete on a set list it could not read", async () => {
    // An empty list from a failed read is not "no sets": deleting on it would
    // skip every set's coach-comment check and leave the sets orphaned.
    loaded.fail = true;
    const { user } = setup();
    await screen.findByText("Nothing in this session");
    await user.click(screen.getByRole("button", { name: "Delete session" }));
    await user.click(screen.getByRole("button", { name: "Delete session" }));
    expect(await screen.findByRole("status")).toHaveTextContent("needs signal");
    expect(sessionEdits.checkSessionDeletable).not.toHaveBeenCalled();
    expect(sessionEdits.deleteSessionAndSets).not.toHaveBeenCalled();
  });

  it("can be backed out of", async () => {
    const { user } = setup();
    await screen.findByRole("region", { name: "Squat" });
    await user.click(screen.getByRole("button", { name: "Delete session" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sessionEdits.checkSessionDeletable).not.toHaveBeenCalled();
  });
});

describe("the athlete's note on a set (F11)", () => {
  it("shows a set's note in full under its row", async () => {
    loaded.sets = [set({ clientSetId: "st-1", notes: "Left hip pinched out of the hole.\nBelt one notch tighter." })];
    setup();
    const note = await screen.findByText(/Left hip pinched out of the hole/);
    expect(note.closest("[data-set-note]")).toHaveTextContent("Belt one notch tighter.");
  });

  it("adds a note to a set from the row's edit, saved through editSet with the four values", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Add a note to set 1" }));
    const box = screen.getByRole("textbox", { name: "Note on Set 1" });
    expect(box).toHaveFocus();
    await user.type(box, "  Felt slow off the chest  ");
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][1]).toEqual({
      loadKg: 140,
      reps: 5,
      rpe: 8,
      isWarmup: false,
      failed: false,
      notes: "Felt slow off the chest",
    });
    // Shown at once, trimmed.
    expect(await screen.findByText("Felt slow off the chest")).toBeInTheDocument();
  });

  it("opens straight onto an existing note, and a blank one clears it", async () => {
    loaded.sets = [set({ clientSetId: "st-1", notes: "Hip pinched" })];
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    const box = screen.getByRole("textbox", { name: "Note on Set 1" });
    expect(box).toHaveValue("Hip pinched");
    await user.clear(box);
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][1]).toMatchObject({ notes: null });
    expect(screen.queryByText("Hip pinched")).not.toBeInTheDocument();
  });

  it("counts down near the 500-character limit and stops there", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Add a note to set 1" }));
    const box = screen.getByRole("textbox", { name: "Note on Set 1" });
    expect(box).toHaveAttribute("maxLength", "500");
    await user.click(box);
    await user.paste("x".repeat(450));
    expect(screen.getByText("50 left")).toBeInTheDocument();
  });
});

describe("a failed set (F19)", () => {
  it("is marked Failed on its row in History", async () => {
    loaded.sets = [set({ clientSetId: "st-1", loadKg: 200, reps: 0, rpe: 10, e1rmKg: null, failed: true })];
    setup();
    expect(await screen.findByRole("img", { name: "Set 1: failed" })).toBeInTheDocument();
    // The row is a button, whose name is all a screen reader hears of it.
    expect(screen.getByRole("button", { name: "Edit set 1 of Squat, failed" })).toBeInTheDocument();
  });

  it("can be corrected to failed with the reps actually completed, from the pad's switch", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "Backspace" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("switch", { name: "Failed" }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));
    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 140, reps: 2, rpe: 8, isWarmup: false, failed: true, notes: null });
  });
});

describe("correcting a bodyweight set (F20)", () => {
  beforeEach(() => {
    library.exercises = [
      { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
      { id: "pull-up", name: "Pull Up", normalisedName: "pull up", isGlobal: true, isBodyweight: true },
    ];
    loaded.sets = [
      set({ clientSetId: "st-1" }),
      set({ clientSetId: "pu-1", exerciseId: "pull-up", loadKg: 10, reps: 8, rpe: 9, e1rmKg: null }),
    ];
  });

  it("saves a pull-up corrected to 0 kg", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Pull Up" }));
    for (let i = 0; i < 2; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    await user.click(screen.getByRole("button", { name: "0" }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][1]).toMatchObject({ loadKg: 0, reps: 8 });
  });

  it("will not save a squat corrected to 0 kg, even if its confirm fires, and says why", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    await user.click(screen.getByRole("button", { name: "0" }));

    const confirm = screen.getByRole("button", { name: /^Log Set 1$/ });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription("0 kg logs only on a bodyweight exercise");
    await act(async () => activeConfirm.current?.());
    expect(editSet).not.toHaveBeenCalled();
  });
});

describe("a cardio set in History (F23)", () => {
  const cardio = (over: Partial<HistorySet> = {}) =>
    set({
      exerciseId: "tm",
      clientSetId: "st-c",
      loadKg: 0,
      reps: 0,
      rpe: null,
      e1rmKg: null,
      durationSeconds: 1230,
      level: 8,
      loggedAt: new Date("2026-09-14T10:00:00Z"),
      ...over,
    });

  beforeEach(() => {
    library.exercises = [
      { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
      { id: "tm", name: "Treadmill", normalisedName: "treadmill", isGlobal: true, kind: "cardio" },
    ];
    loaded.sets = [set({ clientSetId: "st-1" }), cardio()];
  });

  it("reads as a time and a level under its exercise, and the header counts it apart", async () => {
    setup({ setCount: 1, tonnageKg: 700 });
    const block = await screen.findByRole("region", { name: "Treadmill" });
    expect(block).toHaveTextContent("CARDIO · 21 min");
    expect(screen.getByLabelText("Set 1 time, 20 minutes 30 seconds")).toHaveTextContent("20:30");
    expect(screen.getByLabelText("Set 1 level")).toHaveTextContent("8");
    // Strength totals are the squat's alone; cardio has its own figure.
    expect(screen.getByText(/1 set · 700 kg · 21 min cardio/)).toBeInTheDocument();
    // No Lift Detail link for a cardio block.
    expect(screen.queryByRole("link", { name: "Treadmill progression" })).not.toBeInTheDocument();
  });

  it("corrects the time on the pad and saves it as cardio, with the strength values inert", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Treadmill" }));
    expect(screen.getByRole("region", { name: "Time, min keypad" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Warm-up" })).not.toBeInTheDocument();
    for (const key of ["2", "5"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));

    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][0]).toBe("st-c");
    expect(editSet.mock.calls[0][1]).toEqual({
      loadKg: 0,
      reps: 0,
      rpe: null,
      isWarmup: false,
      failed: false,
      notes: null,
      durationSeconds: 1500,
      level: 8,
    });
    // The stored totals are restated from the squat alone: the cardio set
    // is never counted, however it was corrected.
    await waitFor(() => expect(sessionEdits.reviseSessionTotals).toHaveBeenCalledWith("s1", { setCount: 1, tonnageKg: 700 }));
  });

  it("clears the level and keeps the time", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Treadmill" }));
    await user.click(screen.getByRole("button", { name: "Set 1 level" }));
    await user.click(screen.getByRole("button", { name: "Backspace" }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));
    await waitFor(() => expect(editSet).toHaveBeenCalledTimes(1));
    expect(editSet.mock.calls[0][1]).toMatchObject({ durationSeconds: 1230, level: null });
  });

  it("deletes a cardio set like any set", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Treadmill" }));
    await user.click(screen.getByRole("button", { name: "Delete set" }));
    await waitFor(() => expect(removeSet).toHaveBeenCalledWith("st-c", expect.objectContaining({ exerciseId: "tm" })));
  });
});

describe("restating totals keeps a missed 0-rep set counted (F19 beside F23)", () => {
  it("passes the failed flag through, so the fail-closed rule for 0 reps does not drop a real miss", async () => {
    loaded.sets = [
      set({ clientSetId: "st-1" }),
      set({ clientSetId: "st-f", setIndex: 2, loadKg: 200, reps: 0, rpe: 10, failed: true, e1rmKg: null }),
    ];
    const { user } = setup({ setCount: 2, tonnageKg: 700 });
    await user.click(await screen.findByRole("button", { name: "Edit set 1 of Squat" }));
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Backspace" }));
    for (const key of ["1", "5", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: /^Log Set 1$/ }));
    await waitFor(() => expect(sessionEdits.reviseSessionTotals).toHaveBeenCalledWith("s1", { setCount: 2, tonnageKg: 750 }));
  });
});
