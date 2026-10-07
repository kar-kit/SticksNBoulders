import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogScreen, UNDO_MS } from "./log-screen";
import type { SessionRecord } from "@/lib/logging/session";
import type { Exercise } from "@/lib/exercises/match";
import { createMemoryStore } from "@/lib/offline/memory-store";
import { rememberRest } from "@/lib/logging/rest-store";
import { attachQueue, enqueue, resetQueueForTests } from "@/lib/offline/client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } },
    refresh: vi.fn(),
  }),
}));

const library = vi.hoisted(() => ({ exercises: [] as Exercise[], remember: vi.fn() }));
vi.mock("@/lib/exercises/library-context", () => ({
  useExerciseLibrary: () => ({
    state: { status: "ready", exercises: library.exercises },
    remember: library.remember,
    reload: vi.fn(),
  }),
}));

const resolveOrCreateExercise = vi.hoisted(() => vi.fn());
vi.mock("@/lib/exercises/library", () => ({ resolveOrCreateExercise }));

const storedSets = vi.hoisted(() => ({ value: [] as unknown[], fail: 0 }));
vi.mock("@/lib/logging/session-store", () => ({
  fetchSessionSets: async () => {
    if (storedSets.fail > 0) {
      storedSets.fail -= 1;
      throw new TypeError("Failed to fetch");
    }
    return storedSets.value;
  },
}));

// Typed so the argument assertions below are checked rather than assumed.
const logSet = vi.hoisted(() => vi.fn<(input: Record<string, unknown>) => Promise<void>>());
const removeSet = vi.hoisted(() =>
  vi.fn<(clientSetId: string, set?: { exerciseId: string; loggedAt: Date }) => Promise<{ queued: boolean }>>(),
);
let clientIds = 0;
vi.mock("@/lib/logging/set-store", () => ({
  logSet,
  removeSet,
  newClientSetId: () => `cs-${++clientIds}`,
}));

const comments = vi.hoisted(() => ({ value: [] as { setId: string; authorId: string }[] }));
vi.mock("@/lib/review/comment-store", () => ({
  fetchCommentsForSets: async () => comments.value,
}));

const training = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/logging/session-context", () => ({
  useTrainingSessions: () => training.value,
}));

// Free sessions read no prescription. The describe at the bottom swaps in a day.
const prescribed = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/programming/use-prescribed", () => ({
  usePrescribedSession: (dayId: string | null | undefined) =>
    dayId && prescribed.value
      ? prescribed.value
      : { status: "idle", day: null, maxes: { entries: [], estimated: new Map() } },
}));

// Order 28. The target a prescription would supply (none exist yet -- Order
// 22), and the link row the athlete reads the coach's switch from.
const targets = vi.hoisted(() => ({ value: null as { reps: number; rpe: number } | null }));
vi.mock("@/lib/logging/set-targets", () => ({ setTargetFor: () => targets.value }));

const linkRead = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  offline: false,
}));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "sticksnboulders",
    tables: {
      listRows: async () => {
        if (linkRead.offline) throw new TypeError("Failed to fetch");
        return { rows: linkRead.rows };
      },
    },
  }),
}));

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  clientSessionId: "c1",
  startedAt: new Date(Date.now() - 47 * 60_000),
  finishedAt: null,
  setCount: 0,
  tonnageKg: 0,
  ...overrides,
});

const squat: Exercise = { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true };

function setup(overrides: Record<string, unknown> = {}, userOptions: Parameters<typeof userEvent.setup>[0] = {}) {
  const start = vi.fn(async () => session());
  const finish = vi.fn(async () => {});
  training.value = {
    state: { status: "ready", sessions: [] },
    active: null,
    lastFinished: null,
    start,
    finish,
    reload: vi.fn(),
    ...overrides,
  };
  const { unmount } = render(<LogScreen />);
  return { start, finish, unmount, user: userEvent.setup(userOptions) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The rest timer is remembered across a reload, and jsdom keeps localStorage
  // between tests in a file. Without this, one test's rest hides the next
  // test's typeahead -- they share the bottom of the screen.
  localStorage.clear();
  // Both resolve by default: clearAllMocks wipes the implementation, and a
  // mock that returns undefined is not a stand-in for one that returns a
  // promise -- the screen awaits both.
  logSet.mockResolvedValue(undefined);
  removeSet.mockResolvedValue({ queued: true });
  library.exercises = [squat];
  storedSets.value = [];
  storedSets.fail = 0;
  comments.value = [];
  clientIds = 0;
  prescribed.value = null;
  targets.value = null;
  linkRead.rows = [];
  linkRead.offline = false;
});

describe("with no session running", () => {
  it("says so and offers to start one", async () => {
    const { user, start } = setup();
    expect(screen.getByText("No session running")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start a session" }));
    expect(start).toHaveBeenCalled();
  });
});

describe("with a session running", () => {
  it("shows the elapsed clock, derived from when it started", () => {
    setup({ active: session() });
    expect(screen.getByRole("button", { name: "Finish session" })).toHaveTextContent(/0:47:\d\d/);
  });

  it("states that nothing is logged rather than showing a blank screen", () => {
    setup({ active: session() });
    expect(screen.getByText("Nothing logged yet")).toBeInTheDocument();
  });

  it("adds an exercise from the library by typing", async () => {
    const { user } = setup({ active: session() });
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));

    expect(await screen.findByRole("region", { name: "Squat" })).toBeInTheDocument();
  });

  it("creates one the library does not hold, and remembers it", async () => {
    // The seam Order 6 left open: a created exercise has to reach the library
    // too, or the next screen to read it would not know the lift exists.
    const zercher: Exercise = {
      id: "z1", name: "Zercher Squat", normalisedName: "zercher squat", isGlobal: false, ownerId: "joey",
    };
    resolveOrCreateExercise.mockResolvedValue({ exercise: zercher, created: true });

    const { user } = setup({ active: session() });
    await user.type(screen.getByRole("combobox"), "Zercher Squat");
    await user.click(screen.getByRole("option", { name: /Add custom exercise/ }));

    await waitFor(() => expect(library.remember).toHaveBeenCalledWith(zercher));
    expect(await screen.findByRole("region", { name: "Zercher Squat" })).toBeInTheDocument();
  });

  it("rebuilds its exercises from the sets when a session is resumed", async () => {
    // There is no session_exercises table: an exercise is in a session because
    // work was logged against it, so resuming reads the work back.
    storedSets.value = [
      { exerciseId: "squat", clientSetId: "a", loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false, loggedAt: new Date() },
      { exerciseId: "squat", clientSetId: "b", loadKg: 145, reps: 5, rpe: 9, isWarmup: false, loggedAt: new Date() },
    ];
    setup({ active: session() });

    expect(await screen.findByRole("region", { name: "Squat" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("142.5");
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("145");
  });

  it("numbers working sets and marks warm-ups W", async () => {
    storedSets.value = [
      { exerciseId: "squat", clientSetId: "w", loadKg: 60, reps: 5, rpe: null, isWarmup: true, loggedAt: new Date() },
      { exerciseId: "squat", clientSetId: "a", loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false, loggedAt: new Date() },
    ];
    setup({ active: session() });

    // A session that warmed up four times still calls the first working set 1.
    expect(await screen.findByRole("group", { name: "Warm-up set" })).toHaveTextContent("60");
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("142.5");
  });

  it("shows an unknown exercise by its id rather than hiding real work", async () => {
    library.exercises = [];
    storedSets.value = [
      { exerciseId: "mystery", clientSetId: "a", loadKg: 100, reps: 5, rpe: null, isWarmup: false, loggedAt: new Date() },
    ];
    setup({ active: session() });
    expect(await screen.findByRole("region", { name: "mystery" })).toBeInTheDocument();
  });
});

describe("logging a set", () => {
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };

  it("gives an empty row to enter, and will not log it half-filled", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);

    const confirm = screen.getByRole("button", { name: "Log Set 1" });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(logSet).not.toHaveBeenCalled();
  });

  it("types a weight and reps on the pad, never a keyboard", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);

    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    for (const key of ["1", "4", "2", ".", "5"]) {
      await user.click(screen.getByRole("button", { name: key === "." ? "Decimal point" : key }));
    }
    // No text input exists on this screen at all: the pad is the only way in.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));

    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("142.5");
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("5");
  });

  const enterSet = async (user: ReturnType<typeof userEvent.setup>, kg: string, reps: string) => {
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of [...kg]) {
      await user.click(screen.getByRole("button", { name: key === "." ? "Decimal point" : key }));
    }
    await user.click(screen.getByRole("button", { name: "Reps" }));
    for (const key of [...reps]) await user.click(screen.getByRole("button", { name: key }));
  };

  it("logs the set and writes it with the row's own id", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({
      exerciseId: "squat",
      loadKg: 140,
      reps: 5,
      isWarmup: false,
      clientSetId: expect.stringMatching(/^cs-/),
    });
  });

  it("marks the set done and adds no row below it", async () => {
    // Joey: "It should be 'mark as completed' and that's it, no adding new sets."
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Log / })).not.toBeInTheDocument();
    // The pad closed with the confirm; nothing is left half-entered.
    expect(screen.queryByRole("button", { name: "Decimal point" })).not.toBeInTheDocument();
    // The way on is still right there, and the rest started as always.
    expect(screen.getByRole("button", { name: "Add a set to Squat" })).toBeInTheDocument();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("prefills the Add set row from the set just logged, so a straight set needs nothing typed", async () => {
    // Rule 3 of the prefill order, and the blueprint calls it the one that
    // matters most: straight sets are the norm.
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));

    const next = screen.getByRole("group", { name: "Set 2" });
    expect(next).toHaveTextContent("140");
    expect(next).toHaveTextContent("5");
    // It is the exercise's head, so its square logs it.
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
    expect(logSet.mock.calls[1][0]).toMatchObject({ loadKg: 140, reps: 5, setIndex: 2 });
    expect(screen.queryByRole("group", { name: "Set 3" })).not.toBeInTheDocument();
  });

  it("goes back to the name after deleting the only set, rather than stranding the exercise", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));

    expect(screen.getByText(/No sets yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Squat" }));
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeInTheDocument();
  });

  it("marks a row as a warm-up from the pad, not a hidden gesture", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    await user.click(screen.getByRole("switch", { name: "Warm-up" }));

    expect(screen.getByRole("group", { name: "Warm-up set" })).toBeInTheDocument();
  });

  it("records the warm-up flag on the write", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "60", "5");
    await user.click(screen.getByRole("switch", { name: "Warm-up" }));
    await user.click(screen.getByRole("button", { name: "Log Warm-up set" }));

    await waitFor(() => expect(logSet).toHaveBeenCalled());
    expect(logSet.mock.calls[0][0]).toMatchObject({ isWarmup: true, loadKg: 60 });
  });

  it("never asks a warm-up for RPE", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    await user.click(screen.getByRole("switch", { name: "Warm-up" }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    // The cell is inert rather than empty: there is no RPE button to press.
    expect(screen.queryByRole("button", { name: "Warm-up set RPE" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Warm-up set RPE")).toBeInTheDocument();
  });

  it("takes an RPE from the sheet, and records Not sure as no answer", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");

    await user.click(screen.getByRole("button", { name: "Set 1 RPE" }));
    await user.click(screen.getByRole("button", { name: "8" }));
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("8");

    await user.click(screen.getByRole("button", { name: "Set 1 RPE" }));
    await user.click(screen.getByRole("button", { name: /not sure/i }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    // A forced guess pollutes the personal RPE curve worse than a null does.
    await waitFor(() => expect(logSet).toHaveBeenCalled());
    expect(logSet.mock.calls[0][0]).toMatchObject({ rpe: null });
  });

  it("takes the row back off when the write fails, rather than leaving a lie", async () => {
    // Order 9 turns this into a queue that survives. Until then, a set that did
    // not reach Appwrite must not sit there looking logged.
    logSet.mockRejectedValueOnce(new Error("no signal"));
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    await waitFor(() => expect(logSet).toHaveBeenCalled());
    // Not logged, so not shown as logged -- but the numbers come back as the
    // row to confirm, rather than vanishing with the set.
    await waitFor(() => expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled());
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
  });
});

describe("finishing", () => {
  it("confirms first, and can be backed out of", async () => {
    const { user, finish } = setup({ active: session() });
    await user.click(screen.getByRole("button", { name: "Finish session" }));
    expect(screen.getByText(/Finish this session\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep going" }));
    expect(finish).not.toHaveBeenCalled();
    expect(screen.queryByText(/Finish this session\?/)).not.toBeInTheDocument();
  });

  it("writes the totals from the session's own sets", async () => {
    storedSets.value = [
      { exerciseId: "squat", clientSetId: "w", loadKg: 100, reps: 5, rpe: null, isWarmup: true, loggedAt: new Date() },
      { exerciseId: "squat", clientSetId: "a", loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false, loggedAt: new Date() },
    ];
    const { user, finish } = setup({ active: session() });
    await screen.findByRole("region", { name: "Squat" });

    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    // Warm-ups excluded, so the session total agrees with the weekly rollup.
    expect(finish).toHaveBeenCalledWith("s1", { setCount: 1, tonnageKg: 712.5 });
  });

  it("shows the summary, then goes back to Today", async () => {
    const { user } = setup({ active: session() });
    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByText("Session done")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(push).toHaveBeenCalledWith("/today");
  });

  it("has a dedicated End session button that opens the same confirm", async () => {
    // Joey: "There's no way to end a session at the moment that's obvious."
    // The clock still works; this is the control nobody has to be told about.
    const { user, finish } = setup({ active: session() });
    const end = screen.getByRole("button", { name: "End session" });
    expect(end).toHaveTextContent("End session");

    await user.click(end);
    expect(screen.getByText(/Finish this session\?/)).toBeInTheDocument();
    // The panel replaces it: one finish control at a time.
    expect(screen.queryByRole("button", { name: "End session" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep going" }));
    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(finish).toHaveBeenCalledWith("s1", { setCount: 0, tonnageKg: 0 });
    expect(await screen.findByText("Session done")).toBeInTheDocument();
  });

  it("sits below the last exercise", async () => {
    storedSets.value = [
      { exerciseId: "squat", clientSetId: "a", loadKg: 140, reps: 5, rpe: null, isWarmup: false, loggedAt: new Date() },
    ];
    setup({ active: session() });
    const block = await screen.findByRole("region", { name: "Squat" });
    const end = screen.getByRole("button", { name: "End session" });
    expect(block.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("closes the pad when End session is tapped, so the confirm is not hidden behind it", async () => {
    const { user } = setup({ active: session() });
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    expect(screen.getByRole("button", { name: "Decimal point" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(screen.queryByRole("button", { name: "Decimal point" })).not.toBeInTheDocument();
    expect(screen.getByText(/Finish this session\?/)).toBeInTheDocument();
  });

  it("lets an athlete finish a session they logged nothing into", async () => {
    // Starting one and walking out has to be survivable, and it is every
    // session until Order 8 lands set logging.
    const { user, finish } = setup({ active: session() });
    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(finish).toHaveBeenCalledWith("s1", { setCount: 0, tonnageKg: 0 });
    expect(await screen.findByText("Session done")).toBeInTheDocument();
  });
});

describe("when the gym has no signal", () => {
  it("shows a set that is still queued, with a quiet mark and no error", async () => {
    // The reload case. Appwrite returns nothing because it cannot be reached,
    // and the only record of the set is the queue on the device.
    resetQueueForTests(createMemoryStore());
    await enqueue("set.create", {
      setId: "st-queued",
      sessionId: "s1",
      exerciseId: "squat",
      setIndex: 1,
      loadKg: 140,
      reps: 5,
      rpe: 8,
      isWarmup: false,
      loggedAt: new Date().toISOString(),
    });

    setup({ active: session() });

    const row = await screen.findByRole("group", { name: "Set 1" });
    expect(row).toHaveTextContent("140");
    expect(screen.getByLabelText("Queued, will sync")).toBeInTheDocument();
    expect(screen.getByText("queued · no signal")).toBeInTheDocument();
    // Nothing about it reads as a failure: offline is normal.
    expect(screen.queryByText(/could not be saved/)).not.toBeInTheDocument();
    resetQueueForTests();
  });
});

describe("a reload with no signal", () => {
  it("reads the synced sets again once the queue moves, so the totals include them", async () => {
    // The read fails in the basement. Before, it was never retried: sets that
    // had synced before the reload stayed missing, and the finish wrote
    // totals without them.
    storedSets.value = [logged("a", 140, 30)];
    storedSets.fail = 1;
    resetQueueForTests(createMemoryStore());
    const { user, finish } = setup({ active: session() });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("group", { name: "Set 1" })).not.toBeInTheDocument();

    // Signal back: the queue announces as it drains.
    await act(async () => {
      await enqueue("rollup.refresh", { exerciseId: "squat", loggedAt: new Date().toISOString(), weekKey: "w" });
    });
    expect(await screen.findByRole("group", { name: "Set 1" })).toHaveTextContent("140");

    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(finish).toHaveBeenCalledWith("s1", { setCount: 1, tonnageKg: 700 });
    resetQueueForTests();
  });
});

describe("the rest timer", () => {
  const addAndLog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("combobox", { name: "Add exercise" }));
    await user.click(await screen.findByRole("option", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of ["1", "4", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
  };

  it("starts at two minutes when a set is logged", async () => {
    const { user } = setup({ active: session() });
    await addAndLog(user);

    const timer = await screen.findByRole("timer", { name: "Rest timer" });
    expect(timer).toHaveTextContent("2:00");
  });

  it("takes the bottom of the screen from the typeahead, rather than stacking", async () => {
    // The collision worth naming: logging a set is the same instant the timer
    // starts and the next-exercise box comes back. Both in the thumb zone
    // pushes one of them out of it.
    const { user } = setup({ active: session() });
    await addAndLog(user);

    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Add exercise" })).not.toBeInTheDocument();
  });

  it("gives the box back when the rest is skipped", async () => {
    const { user } = setup({ active: session() });
    await addAndLog(user);
    await user.click(await screen.findByRole("button", { name: "Skip rest" }));

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Add exercise" })).toBeInTheDocument();
  });

  it("adds thirty seconds to the rest on each tap", async () => {
    const { user } = setup({ active: session() });
    await addAndLog(user);
    await user.click(await screen.findByRole("button", { name: "Add 30 seconds to the rest" }));

    // The clock has not moved in this test, so the whole extension shows.
    expect(screen.getByRole("timer")).toHaveTextContent("2:30");
    await user.click(screen.getByRole("button", { name: "Add 30 seconds to the rest" }));
    expect(screen.getByRole("timer")).toHaveTextContent("3:00");
  });

  it("stands down while a number is being entered", async () => {
    // Mid-entry beats everything: the pad is what the thumb is already on.
    const { user } = setup({ active: session() });
    await addAndLog(user);
    expect(await screen.findByRole("timer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    // Adding the row is not entry; the timer keeps the bottom until a field is.
    expect(screen.getByRole("timer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("goes away when the set that started it is deleted, and comes back on Undo", async () => {
    const { user } = setup({ active: session() });
    await addAndLog(user);
    expect(await screen.findByRole("timer")).toBeInTheDocument();

    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));
    await waitFor(() => expect(screen.queryByRole("timer")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("is still running after the page is thrown away", async () => {
    // Stored as a timestamp, so this is the real remaining time and not a
    // counter that restarted.
    const { user, unmount } = setup({ active: session() });
    await addAndLog(user);
    await user.click(await screen.findByRole("button", { name: "Add 30 seconds to the rest" }));
    unmount();

    setup({ active: session() });
    // A little under 2:30, because real seconds passed between the two renders
    // -- which is exactly the proof wanted. A counter that restarted would read
    // 2:00, and one that reset its extension would too.
    expect(await screen.findByRole("timer")).toHaveTextContent(/2:2[0-9]|2:30/);
  });
});

/* ------------------------------------------------------------------------ */

const logged = (id: string, loadKg: number, minutesAgo: number, extra: Record<string, unknown> = {}) => ({
  exerciseId: "squat",
  clientSetId: id,
  loadKg,
  reps: 5,
  rpe: null,
  isWarmup: false,
  loggedAt: new Date(Date.now() - minutesAgo * 60_000),
  ...extra,
});

describe("deleting a set", () => {
  const threeSets = () => {
    storedSets.value = [logged("a", 140, 30, { setIndex: 1 }), logged("b", 150, 20, { setIndex: 2 }), logged("c", 145, 10, { setIndex: 3 })];
  };

  it("deletes any set, not just the last one, and renumbers what is left", async () => {
    threeSets();
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });

    await user.click(screen.getByRole("group", { name: "Set 2" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 2" }));

    // Gone from the screen straight away; the old set 3 is now set 2.
    expect(screen.queryByRole("group", { name: "Set 3" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("145");
    expect(screen.getByRole("status")).toHaveTextContent("Squat set 2 deleted");
  });

  it("does not write the delete until the undo window has passed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      threeSets();
      const { user } = setup({ active: session() }, { advanceTimers: vi.advanceTimersByTime });
      await screen.findByRole("group", { name: "Set 3" });
      await user.click(screen.getByRole("group", { name: "Set 2" }));
      await user.click(screen.getByRole("button", { name: "Delete Set 2" }));
      expect(removeSet).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 10);
      });
      expect(removeSet).toHaveBeenCalledTimes(1);
      // With the set's exercise and time, so the rollup for that week is rebuilt.
      expect(removeSet.mock.calls[0][0]).toBe("b");
      expect(removeSet.mock.calls[0][1]).toMatchObject({ exerciseId: "squat" });
      expect(screen.queryByText("Squat set 2 deleted")).not.toBeInTheDocument();
      // And it stays gone after the toast.
      expect(screen.queryByRole("group", { name: "Set 3" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the set back on Undo and writes nothing", async () => {
    threeSets();
    const { user, unmount } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    await user.click(screen.getByRole("group", { name: "Set 2" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 2" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    expect(screen.getByRole("group", { name: "Set 3" })).toBeInTheDocument();
    unmount();
    expect(removeSet).not.toHaveBeenCalled();
  });

  it("writes the pending delete when the screen is left, rather than dropping it", async () => {
    threeSets();
    const { user, unmount } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));
    unmount();
    expect(removeSet).toHaveBeenCalledWith("a", expect.objectContaining({ exerciseId: "squat" }));
  });

  it("writes the first delete when a second one starts, so only one toast shows", async () => {
    threeSets();
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));

    expect(removeSet).toHaveBeenCalledTimes(1);
    expect(removeSet.mock.calls[0][0]).toBe("a");
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("commits the delete before finishing, and the totals leave the set out", async () => {
    threeSets();
    const { user, finish } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    await user.click(screen.getByRole("group", { name: "Set 2" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 2" }));

    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(removeSet).toHaveBeenCalledWith("b", expect.anything());
    expect(finish).toHaveBeenCalledWith("s1", { setCount: 2, tonnageKg: 1425 });
  });

  it("keeps the rest running when an older set is deleted", async () => {
    // The rest belongs to the set just done. Removing a mistake from earlier
    // in the session says nothing about it.
    threeSets();
    rememberRest({ startedAt: new Date(), restMs: 120_000 });
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));
    expect(screen.getByRole("timer")).toBeInTheDocument();
  });

  it("refuses to delete a set the coach has commented on, and says why", async () => {
    threeSets();
    comments.value = [{ setId: "b", authorId: "coach_ruairi" }];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });

    await user.click(screen.getByRole("group", { name: "Set 2" }));
    expect(await screen.findByText(/Your coach has commented on this set/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Set 2" })).not.toBeInTheDocument();
  });

  it("still lets the athlete delete a set only they have commented on", async () => {
    threeSets();
    comments.value = [{ setId: "b", authorId: "joey" }];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    await user.click(screen.getByRole("group", { name: "Set 2" }));
    expect(await screen.findByRole("button", { name: "Delete Set 2" })).toBeInTheDocument();
  });

  it("closes the actions on Keep", async () => {
    threeSets();
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    await user.click(screen.getByRole("group", { name: "Set 2" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("button", { name: "Delete Set 2" })).not.toBeInTheDocument();
  });

  it("deletes on a swipe left, with the same undo", async () => {
    threeSets();
    setup({ active: session() });
    const row = await screen.findByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 250, clientY: 12 });
    fireEvent.pointerMove(row, { clientX: 150, clientY: 12 });
    fireEvent.pointerUp(row, { clientX: 150, clientY: 12 });

    expect(await screen.findByText("Squat set 1 deleted")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("150");
  });

  it("ignores a short or mostly vertical drag", async () => {
    threeSets();
    setup({ active: session() });
    const row = await screen.findByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 280, clientY: 90 });
    fireEvent.pointerUp(row, { clientX: 280, clientY: 90 });
    expect(screen.queryByText(/deleted/)).not.toBeInTheDocument();
  });

  it("brings a set back when the server refused its delete, with a note that can be dismissed", async () => {
    // The coach commented while the delete sat in the queue. Their thread
    // keeps its set; the athlete is told, once, and nothing reads as lost.
    const store = createMemoryStore();
    resetQueueForTests(store);
    storedSets.value = [logged("a", 140, 30), logged("b", 150, 10)];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));
    // Starting a second delete writes the first; undoing the second keeps it.
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 1" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(removeSet).toHaveBeenCalledWith("a", expect.anything());
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("150");

    await store.put({
      id: "op-refused",
      kind: "set.delete",
      payload: { setId: "a" },
      sequence: 1,
      attempts: 1,
      nextAttemptAt: 0,
      permanentError: "set-has-coach-comments",
    });
    await act(async () => {
      await attachQueue({ userId: "joey" });
    });

    expect(await screen.findByRole("group", { name: "Set 2" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(screen.getByText(/your coach had already commented/)).toBeInTheDocument();
    // Not counted as lost work: nothing was lost.
    expect(screen.queryByText(/could not be saved/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByText(/your coach had already commented/)).not.toBeInTheDocument());
    expect(await store.all()).toHaveLength(0);
    resetQueueForTests();
  });
});

describe("queueing the next set before confirming this one", () => {
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const type = async (user: ReturnType<typeof userEvent.setup>, digits: string) => {
    for (const key of [...digits]) {
      await user.click(screen.getByRole("button", { name: key === "." ? "Decimal point" : key }));
    }
  };

  it("adds a second row prefilled from the first, without moving off the first", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    await type(user, "140");
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await type(user, "5");

    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));

    const second = screen.getByRole("group", { name: "Set 2" });
    expect(second).toHaveTextContent("140");
    expect(second).toHaveTextContent("5");
    // Only the first row carries the confirm square; the second can be removed.
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Log Set 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove planned Set 2" })).toBeInTheDocument();
  });

  it("edits the planned row on its own, for a back-off", async () => {
    storedSets.value = [logged("a", 180, 5)];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 1" });
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));

    await user.click(screen.getByRole("button", { name: "Set 3 weight in kilograms" }));
    await type(user, "160");

    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("180");
    expect(screen.getByRole("group", { name: "Set 3" })).toHaveTextContent("160");
  });

  it("logs the head, then the planned row becomes the next one-tap confirm", async () => {
    storedSets.value = [logged("a", 180, 5, { setIndex: 1 })];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 1" });
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Set 3 weight in kilograms" }));
    await type(user, "160");

    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ loadKg: 180, setIndex: 2 });

    // The planned back-off is next -- not a fresh repeat of 180.
    const next = screen.getByRole("group", { name: "Set 3" });
    expect(next).toHaveTextContent("160");
    expect(screen.queryByRole("group", { name: "Set 4" })).not.toBeInTheDocument();
    // And the rest timer started exactly as it always does.
    expect(await screen.findByRole("timer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Log Set 3" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
    expect(logSet.mock.calls[1][0]).toMatchObject({ loadKg: 160, setIndex: 3 });
    // Nothing planned any more, so nothing follows until Add set is tapped --
    // and then it repeats the set just logged.
    expect(screen.queryByRole("group", { name: "Set 4" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    expect(screen.getByRole("group", { name: "Set 4" })).toHaveTextContent("160");
    expect(screen.getByRole("button", { name: "Log Set 4" })).toBeEnabled();
  });

  it("drops a planned row with its remove button", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Remove planned Set 2" }));
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toBeInTheDocument();
  });

  it("keeps planned rows when the athlete looks at another exercise", async () => {
    const bench: Exercise = { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true };
    library.exercises = [squat, bench];
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));

    await user.type(screen.getByRole("combobox"), "bench");
    await user.click(screen.getByRole("option", { name: "Bench Press" }));

    const squatBlock = screen.getByRole("region", { name: "Squat" });
    expect(within(squatBlock).getByRole("group", { name: "Set 2" })).toBeInTheDocument();
  });

  it("gives set_index one past the highest used, so a deleted set's number is never reused", async () => {
    storedSets.value = [logged("a", 140, 30, { setIndex: 1 }), logged("c", 140, 10, { setIndex: 3 })];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    await user.click(screen.getByRole("button", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: "Log Set 3" }));
    await waitFor(() => expect(logSet).toHaveBeenCalled());
    expect(logSet.mock.calls[0][0]).toMatchObject({ setIndex: 4 });
  });
});

describe("a session started from a prescribed day (Order 22)", () => {
  const line = (over: Record<string, unknown>) => ({
    programId: "p1",
    weekId: "w1",
    dayId: "d1",
    repMax: null,
    restSeconds: null,
    notes: null,
    loadKind: null,
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  });

  beforeEach(() => {
    library.exercises = [squat, { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true }];
    prescribed.value = {
      status: "ready",
      day: {
        program: { id: "p1" },
        week: { id: "w1" },
        day: { id: "d1", label: "Day 1", notes: null },
        prescriptions: [
          line({ id: "sq", exerciseId: "squat", position: 0, setCount: 2, reps: 5, load: "75%" }),
          line({ id: "bp", exerciseId: "bench", position: 1, setCount: 3, reps: 8, load: "80" }),
        ],
      },
      maxes: {
        entries: [
          { id: "m1", exerciseId: "squat", kind: "training", valueKg: 200, effectiveFrom: "2026-01-01T00:00:00Z", recordedBy: "coach" },
        ],
        estimated: new Map(),
      },
    };
  });

  it("lists the prescribed exercises in the coach's order before anything is logged", async () => {
    setup({ active: session({ programDayId: "d1" }) });
    const blocks = await screen.findAllByRole("region");
    expect(blocks.map((b) => b.getAttribute("aria-label"))).toEqual(["Squat", "Bench Press"]);
    expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("2 × 5 · 150 kg (75%)");
  });

  it("opens on the first exercise with the target already in the row, so the first tap logs it", async () => {
    const { user } = setup({ active: session({ programDayId: "d1" }) });
    const row = await screen.findByRole("group", { name: "Set 1" });
    expect(row).toHaveTextContent("150");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({
      exerciseId: "squat",
      loadKg: 150,
      reps: 5,
      prescriptionId: "sq",
      prescribed: "5 reps · 150 kg (75%)",
    });
  });

  it("adds no row after a prescribed set, and Add set brings the next one with its target", async () => {
    // Prescribed rows are not laid out up front either: the athlete asks for
    // each one, and it arrives priced to the coach's line.
    const { user } = setup({ active: session({ programDayId: "d1" }) });
    await screen.findByRole("group", { name: "Set 1" });
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    const squatBlock = screen.getByRole("region", { name: "Squat" });
    expect(within(squatBlock).queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    expect(within(squatBlock).getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
    expect(logSet.mock.calls[1][0]).toMatchObject({ loadKg: 150, reps: 5, prescriptionId: "sq", setIndex: 2 });
  });

  it("gives a free session no targets at all", async () => {
    setup({ active: session() });
    expect(await screen.findByText("Nothing logged yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /prescribed/ })).not.toBeInTheDocument();
  });
});

describe("next-set load suggestions, behind the coach's switch (Order 28)", () => {
  // 170 x 5 @ RPE 7 toward a target of 5 @ RPE 8 suggests 175 -- the worked
  // example in docs/suggestions.md.
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const logTopSet = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of ["1", "7", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Set 1 RPE" }));
    await user.click(screen.getByRole("button", { name: "7" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    // Confirming builds no row; the suggestion arrives with the one Add set makes.
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
  };
  const coachChose = (mode: "direct" | "held" | null) => {
    linkRead.rows = [{ suggestions_mode: mode }];
  };

  beforeEach(() => {
    targets.value = { reps: 5, rpe: 8 };
  });

  it("suggests the next load, marked as a suggestion, when the coach lets them through", async () => {
    coachChose("direct");
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"direct"'));
    await addSquat(user);
    await logTopSet(user);

    const next = await screen.findByRole("group", { name: "Set 2" });
    expect(next).toHaveTextContent("175");
    expect(screen.getByText("suggested from RPE 7 @ 170")).toBeInTheDocument();
  });

  it("treats a link from before Order 28, with no stored choice, as direct", async () => {
    coachChose(null);
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"direct"'));
    await addSquat(user);
    await logTopSet(user);
    expect(await screen.findByText("suggested from RPE 7 @ 170")).toBeInTheDocument();
  });

  it("shows no suggestion when the coach holds them, and repeats the set instead", async () => {
    coachChose("held");
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"held"'));
    await addSquat(user);
    await logTopSet(user);

    const next = await screen.findByRole("group", { name: "Set 2" });
    expect(next).toHaveTextContent("170");
    expect(next).not.toHaveTextContent("175");
    expect(screen.queryByText(/suggested from/)).not.toBeInTheDocument();
  });

  it("marks the prefilled load Suggested while it stands", async () => {
    coachChose("direct");
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"direct"'));
    await addSquat(user);
    await logTopSet(user);

    const next = await screen.findByRole("group", { name: "Set 2" });
    expect(within(next).getByText("Suggested")).toBeInTheDocument();
    expect(screen.getAllByText("Suggested")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Set 2 weight in kilograms" })).toHaveAccessibleDescription(
      "Suggested",
    );
    // Logging is never blocked on it: the confirm square is live.
    expect(screen.getByRole("button", { name: "Log Set 2" })).toBeEnabled();
  });

  it("clears the marker the moment the athlete edits the load", async () => {
    coachChose("direct");
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"direct"'));
    await addSquat(user);
    await logTopSet(user);
    await screen.findByText("Suggested");

    await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
    // Opening the pad is not an edit.
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
    expect(screen.queryByText(/suggested from/)).not.toBeInTheDocument();
  });

  it("keeps the marker when the athlete changes only the reps", async () => {
    coachChose("direct");
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"direct"'));
    await addSquat(user);
    await logTopSet(user);
    await screen.findByText("Suggested");

    await user.click(screen.getByRole("button", { name: "Set 2 reps" }));
    await user.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getByText("Suggested")).toBeInTheDocument();
  });

  it("shows no marker when the coach holds suggestions", async () => {
    coachChose("held");
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"held"'));
    await addSquat(user);
    await logTopSet(user);
    await screen.findByRole("group", { name: "Set 2" });
    expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("drops the note once the athlete types their own load", async () => {
    coachChose("direct");
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"direct"'));
    await addSquat(user);
    await logTopSet(user);
    await screen.findByText("suggested from RPE 7 @ 170");

    await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(screen.queryByText(/suggested from/)).not.toBeInTheDocument();
  });

  describe("with no signal", () => {
    it("keeps obeying a held switch it read earlier", async () => {
      localStorage.setItem(
        "snb.suggestion-mode",
        JSON.stringify({ athleteId: "joey", mode: "held", readAt: new Date().toISOString() }),
      );
      linkRead.offline = true;
      const { user } = setup({ active: session() });
      await addSquat(user);
      await logTopSet(user);

      expect(await screen.findByRole("group", { name: "Set 2" })).toHaveTextContent("170");
      expect(screen.queryByText(/suggested from/)).not.toBeInTheDocument();
    });

    it("keeps suggesting under a direct switch it read earlier", async () => {
      localStorage.setItem(
        "snb.suggestion-mode",
        JSON.stringify({ athleteId: "joey", mode: "direct", readAt: new Date().toISOString() }),
      );
      linkRead.offline = true;
      const { user } = setup({ active: session() });
      await addSquat(user);
      await logTopSet(user);
      expect(await screen.findByText("suggested from RPE 7 @ 170")).toBeInTheDocument();
      // The marker needs no request either: it is row state.
      expect(screen.getByText("Suggested")).toBeInTheDocument();
    });

    it("ignores a cached switch that belongs to somebody else who used this phone", async () => {
      localStorage.setItem(
        "snb.suggestion-mode",
        JSON.stringify({ athleteId: "someone-else", mode: "direct", readAt: new Date().toISOString() }),
      );
      linkRead.offline = true;
      const { user } = setup({ active: session() });
      await addSquat(user);
      await logTopSet(user);
      expect(await screen.findByRole("group", { name: "Set 2" })).toHaveTextContent("170");
      expect(screen.queryByText(/suggested from/)).not.toBeInTheDocument();
    });

    it("suggests nothing on a device that has never been told, and still logs", async () => {
      linkRead.offline = true;
      const { user } = setup({ active: session() });
      await addSquat(user);
      await logTopSet(user);

      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
      expect(await screen.findByRole("group", { name: "Set 2" })).toHaveTextContent("170");
      expect(screen.queryByText(/suggested from/)).not.toBeInTheDocument();
    });
  });

  it("suggests nothing without a prescribed target, even when the coach allows it", async () => {
    coachChose("direct");
    targets.value = null;
    const { user } = setup({ active: session() });
    await waitFor(() => expect(localStorage.getItem("snb.suggestion-mode")).toContain('"direct"'));
    await addSquat(user);
    await logTopSet(user);
    expect(await screen.findByRole("group", { name: "Set 2" })).toHaveTextContent("170");
    expect(screen.queryByText(/suggested from/)).not.toBeInTheDocument();
  });
});
