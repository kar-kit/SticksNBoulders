import { render, screen, waitFor } from "@testing-library/react";
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

const loaded = vi.hoisted(() => ({ sets: [] as unknown[] }));
vi.mock("@/lib/logging/history-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/history-store")>()),
  fetchSetsForSessions: async () => loaded.sets,
}));

const editSet = vi.hoisted(() =>
  vi.fn<(id: string, edit: Record<string, unknown>, set: Record<string, unknown>) => Promise<void>>(),
);
const removeSet = vi.hoisted(() =>
  vi.fn<(id: string, set?: Record<string, unknown>) => Promise<void>>(),
);
vi.mock("@/lib/logging/set-store", () => ({ editSet, removeSet }));

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

function setup() {
  training.value = {
    state: { status: "ready", sessions: [session] },
    active: null,
    lastFinished: null,
    start: vi.fn(),
    finish: vi.fn(),
    reload: vi.fn(),
  };
  render(<SessionDetail sessionId="s1" />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 145, reps: 5, rpe: 8, isWarmup: false });
    // And the exercise and week, so the rollup behind it can be recomputed.
    expect(editSet.mock.calls[0][2]).toMatchObject({ exerciseId: "squat" });
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
    }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("150"));
  });
});
