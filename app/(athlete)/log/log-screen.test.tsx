import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogScreen } from "./log-screen";
import type { SessionRecord } from "@/lib/logging/session";
import type { Exercise } from "@/lib/exercises/match";
import { createMemoryStore } from "@/lib/offline/memory-store";
import { enqueue, resetQueueForTests } from "@/lib/offline/client";

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

const storedSets = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/lib/logging/session-store", () => ({
  fetchSessionSets: async () => storedSets.value,
}));

// Typed so the argument assertions below are checked rather than assumed.
const logSet = vi.hoisted(() => vi.fn<(input: Record<string, unknown>) => Promise<void>>());
const removeSet = vi.hoisted(() => vi.fn<(clientSetId: string) => Promise<void>>());
let clientIds = 0;
vi.mock("@/lib/logging/set-store", () => ({
  logSet,
  removeSet,
  newClientSetId: () => `cs-${++clientIds}`,
}));

const training = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/logging/session-context", () => ({
  useTrainingSessions: () => training.value,
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

function setup(overrides: Record<string, unknown> = {}) {
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
  render(<LogScreen />);
  return { start, finish, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Both resolve by default: clearAllMocks wipes the implementation, and a
  // mock that returns undefined is not a stand-in for one that returns a
  // promise -- the screen awaits both.
  logSet.mockResolvedValue(undefined);
  removeSet.mockResolvedValue(undefined);
  library.exercises = [squat];
  storedSets.value = [];
  clientIds = 0;
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

  it("prefills the next row from the set just logged, so a straight set is one tap", async () => {
    // Rule 3 of the prefill order, and the blueprint calls it the one that
    // matters most: straight sets are the norm.
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    const next = await screen.findByRole("group", { name: "Set 2" });
    expect(next).toHaveTextContent("140");
    expect(next).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: "Log Set 2" })).toBeEnabled();
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

  it("undoes the set that was just logged", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await screen.findByRole("group", { name: "Set 2" });

    await user.click(screen.getByRole("button", { name: "Undo last set" }));

    await waitFor(() => expect(removeSet).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
  });

  it("takes the row back off when the write fails, rather than leaving a lie", async () => {
    // Order 9 turns this into a queue that survives. Until then, a set that did
    // not reach Appwrite must not sit there looking logged.
    logSet.mockRejectedValueOnce(new Error("no signal"));
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    await waitFor(() => expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument());
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
