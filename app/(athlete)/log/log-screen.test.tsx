import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogScreen, UNDO_MS } from "./log-screen";
import type { SessionRecord } from "@/lib/logging/session";
import type { Exercise } from "@/lib/exercises/match";
import { createMemoryStore } from "@/lib/offline/memory-store";
import { rememberRest } from "@/lib/logging/rest-store";
import { weekStart } from "@/lib/strength/rollup";
import { REST_BUZZ } from "@/lib/logging/rest-timer";
import { attachQueue, enqueue, resetQueueForTests } from "@/lib/offline/client";
import type { QueueStore } from "@/lib/offline/queue";
import { UnitsProvider } from "@/lib/profile/units-context";
import { forgetExerciseHistory } from "@/lib/logging/use-exercise-history";
import { HAPTICS } from "@/lib/ui/haptics";

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

// `hold` keeps the read on the wire until the test lets it go, so the order
// of "screen renders" and "sets arrive" is the test's, not the scheduler's.
const storedSets = vi.hoisted(() => ({ value: [] as unknown[], fail: 0, hold: null as Promise<void> | null }));
vi.mock("@/lib/logging/session-store", () => ({
  fetchSessionSets: async () => {
    if (storedSets.hold) await storedSets.hold;
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
const editSet = vi.hoisted(() =>
  vi.fn<
    (
      clientSetId: string,
      edit: { loadKg: number; reps: number; rpe: number | null; isWarmup: boolean; notes?: string | null },
      set: { exerciseId: string; loggedAt: Date },
    ) => Promise<void>
  >(),
);
let clientIds = 0;
// The real module is kept to hand so the tests at the bottom can follow a set
// past the screen into the queue; everything else talks to the mocks.
const realSetStore = vi.hoisted(() => ({ value: null as unknown as typeof import("@/lib/logging/set-store") }));
vi.mock("@/lib/logging/set-store", async (importOriginal) => {
  realSetStore.value = await importOriginal<typeof import("@/lib/logging/set-store")>();
  return {
    logSet,
    editSet,
    removeSet,
    newClientSetId: () => `cs-${++clientIds}`,
  };
});

// The clip upload and the old file's retirement, for attaching from the edit
// sheet (F17). Everything else in both modules is the real thing.
const attachClipToSet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/video/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video/upload")>()),
  attachClipToSet,
}));
const retireReplacedClip = vi.hoisted(() => vi.fn<(setId: string, fileId: string) => Promise<void>>(async () => {}));
vi.mock("@/lib/video/my-clips-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video/my-clips-store")>()),
  retireReplacedClip,
}));

// The Log landing's "This week" rollup read. Rows are this week's by default.
const weekRollups = vi.hoisted(() => ({
  value: [] as { weekStart: string; setCount: number; tonnageKg: number }[],
  fail: false,
}));
vi.mock("@/lib/logging/week-summary-store", () => ({
  fetchWeekRollupsFor: async () => {
    if (weekRollups.fail) throw new TypeError("Failed to fetch");
    return weekRollups.value;
  },
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

// Last time and the bests to beat (F6). Read in the background per exercise;
// `hold` keeps reads on the wire, `fail` makes them fail like a dead signal.
const exerciseHistory = vi.hoisted(() => ({
  value: {} as Record<string, { previous: unknown[]; bests: unknown }>,
  fail: false,
  hold: null as Promise<void> | null,
  calls: [] as string[],
}));
vi.mock("@/lib/logging/exercise-history-store", () => ({
  fetchExerciseHistory: async (_athleteId: string, exerciseId: string) => {
    exerciseHistory.calls.push(exerciseId);
    if (exerciseHistory.hold) await exerciseHistory.hold;
    if (exerciseHistory.fail) throw new TypeError("Failed to fetch");
    return exerciseHistory.value[exerciseId] ?? { previous: [], bests: null };
  },
}));

// The athlete's profile, read by the real UnitsProvider in the pounds tests.
// Nothing else on this screen reads it, and outside the provider it is kilos.
const profile = vi.hoisted(() => ({ units: "kg" as "kg" | "lb" }));
vi.mock("@/lib/profile/profile-store", () => ({
  fetchProfile: async (userId: string) => ({
    userId,
    displayName: "Joey",
    sex: null,
    units: profile.units,
    avatarFileId: null,
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

function setup(
  { withUnits = false, inMain = false, ...overrides }: Record<string, unknown> = {},
  userOptions: Parameters<typeof userEvent.setup>[0] = {},
) {
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
  const { unmount } = render(
    withUnits ? (
      <UnitsProvider userId="joey">
        <LogScreen />
      </UnitsProvider>
    ) : (
      <LogScreen />
    ),
    // The shell's <main> is what scrolls; the sheet tests need one to scroll.
    inMain ? { container: document.body.appendChild(document.createElement("main")) } : undefined,
  );
  return { start, finish, unmount, user: userEvent.setup(userOptions) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The rest timer is remembered across a reload, and jsdom keeps localStorage
  // between tests in a file. Without this, one test's rest hides the next
  // test's typeahead -- they share the bottom of the screen.
  localStorage.clear();
  // The provider that reads the queue in is mocked away, so each test starts
  // with it read and empty; one that needs a queue hands over its own store.
  resetQueueForTests();
  // Both resolve by default: clearAllMocks wipes the implementation, and a
  // mock that returns undefined is not a stand-in for one that returns a
  // promise -- the screen awaits both.
  logSet.mockResolvedValue(undefined);
  removeSet.mockResolvedValue({ queued: true });
  editSet.mockResolvedValue(undefined);
  library.exercises = [squat];
  storedSets.value = [];
  storedSets.fail = 0;
  storedSets.hold = null;
  comments.value = [];
  clientIds = 0;
  prescribed.value = null;
  targets.value = null;
  linkRead.rows = [];
  linkRead.offline = false;
  profile.units = "kg";
  weekRollups.value = [];
  weekRollups.fail = false;
  exerciseHistory.value = {};
  exerciseHistory.fail = false;
  exerciseHistory.hold = null;
  exerciseHistory.calls = [];
  forgetExerciseHistory();
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

describe("logging a set on a phone that cannot store it", () => {
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const enter140x5 = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of ["1", "4", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
  };

  it("says the set was not saved, rather than quietly putting the row back", async () => {
    logSet.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enter140x5(user);
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/wasn.t saved/);
    // Still the row to confirm, numbers intact, and no rest started for a set
    // that does not exist.
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(screen.queryByRole("timer", { name: "Rest timer" })).not.toBeInTheDocument();
  });

  it("logs it on the next tap once there is room, and the warning goes", async () => {
    logSet.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enter140x5(user);
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(logSet).toHaveBeenCalledTimes(2);
    expect(logSet.mock.calls[1][0]).toMatchObject({ clientSetId: logSet.mock.calls[0][0].clientSetId });
    expect(await screen.findByRole("timer", { name: "Rest timer" })).toBeInTheDocument();
  });

  it("marks the set queued until it is written to the phone, with the rest already running", async () => {
    let written: () => void = () => {};
    logSet.mockImplementationOnce(() => new Promise<void>((resolve) => (written = resolve)));
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enter140x5(user);
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    // The write is under way: the row says it is not yet saved, and the rest
    // has started on the tap rather than on the disk.
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Queued, will sync")).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Rest timer" })).toBeInTheDocument();

    await act(async () => written());
    expect(screen.queryByLabelText("Queued, will sync")).not.toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Rest timer" })).toBeInTheDocument();
  });

  it("puts back the rest that was running when a set cannot be stored", async () => {
    // The rest belongs to the last set that exists. A failed set's rest goes,
    // and the previous set's comes back where it was.
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enter140x5(user);
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await screen.findByRole("timer", { name: "Rest timer" });
    await user.click(screen.getByRole("button", { name: "Add 30 seconds to the rest" }));
    // The screen's one-second clock may tick between the confirm and here.
    expect(screen.getByRole("timer", { name: "Rest timer" })).toHaveTextContent(/2:(30|29)/);

    logSet.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("timer", { name: "Rest timer" })).toHaveTextContent(/2:[23]\d/);
  });

  it("still queues the set when only localStorage is full", async () => {
    // The rest timer and the running session are remembered in localStorage.
    // That failing is a convenience lost, never a set: logSet must still run.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enter140x5(user);
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.restoreAllMocks();
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

  it("keeps the totals on the summary after the session closes", async () => {
    // The real provider clears the active session on finish, and every list on
    // the page is keyed to it. The summary used to recompute from the emptied
    // lists and show 0 sets, 0 kg.
    storedSets.value = [
      { exerciseId: "squat", clientSetId: "w", loadKg: 100, reps: 5, rpe: null, isWarmup: true, loggedAt: new Date() },
      { exerciseId: "squat", clientSetId: "a", loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false, loggedAt: new Date() },
    ];
    const finish = vi.fn(async () => {
      training.value = { ...training.value, active: null };
    });
    const { user } = setup({ active: session(), finish });
    await screen.findByRole("region", { name: "Squat" });

    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByText("Session done")).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText("Sets").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Tonnage").nextElementSibling).toHaveTextContent("712.5 kg");
    expect(screen.getByText("Exercises").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Warm-ups").nextElementSibling).toHaveTextContent("1");
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

describe("reopened with no signal, before the queue is read back in", () => {
  // The e2e:pwa case. The session is remembered on the device and known at
  // once; the set is only in the queue, which takes a moment to read off disk.
  // Shown in that moment, the session was empty -- Finish in place, Set 1
  // nowhere -- and the set popped in a beat later.
  it("shows the session whole or not at all: never Finish without the queued set", async () => {
    const store = createMemoryStore();
    await store.put({
      id: "op-on-disk",
      kind: "set.create",
      payload: {
        setId: "st-queued",
        sessionId: "s1",
        exerciseId: "squat",
        setIndex: 1,
        loadKg: 100,
        reps: 5,
        rpe: null,
        isWarmup: false,
        loggedAt: new Date().toISOString(),
      },
      sequence: 0,
      attempts: 0,
      nextAttemptAt: 0,
      ownerId: "joey",
    });
    resetQueueForTests(store, { loaded: false });
    onTestFinished(() => resetQueueForTests());
    storedSets.fail = 1_000;

    // Every DOM change is checked, not just where the test happens to look:
    // the bug lived between two renders.
    const halfShown: string[] = [];
    const watch = new MutationObserver(() => {
      const finish = document.querySelector('[aria-label="Finish session"]');
      const set = document.querySelector('[role="group"][aria-label="Set 1"]');
      if (finish && !set) halfShown.push(document.body.textContent ?? "");
    });
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    onTestFinished(() => watch.disconnect());

    setup({ active: session() });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish session" })).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing logged yet")).not.toBeInTheDocument();

    // The provider reads the queue in, exactly as on a real reopen.
    await act(async () => {
      await attachQueue({ userId: "joey" });
    });

    expect(screen.getByRole("button", { name: "Finish session" })).toBeInTheDocument();
    const row = screen.getByRole("group", { name: "Set 1" });
    expect(row).toHaveTextContent("100");
    expect(screen.getByLabelText("Queued, will sync")).toBeInTheDocument();
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(halfShown).toEqual([]);
  });

  it("opens straight onto the queued sets when the queue was already read (from Today)", async () => {
    const store = createMemoryStore();
    resetQueueForTests(store);
    onTestFinished(() => resetQueueForTests());
    await enqueue("set.create", {
      setId: "st-queued",
      sessionId: "s1",
      exerciseId: "squat",
      setIndex: 1,
      loadKg: 100,
      reps: 5,
      rpe: null,
      isWarmup: false,
      loggedAt: new Date().toISOString(),
    });
    storedSets.fail = 1_000;

    setup({ active: session() });
    // Right after the render, with nothing awaited.
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("100");
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

    // The whole extension shows. The screen's real one-second clock can tick
    // once between the confirm and the read on a loaded CI box, so a second
    // either way is the same answer, not a flake.
    expect(screen.getByRole("timer")).toHaveTextContent(/2:(30|29)/);
    await user.click(screen.getByRole("button", { name: "Add 30 seconds to the rest" }));
    expect(screen.getByRole("timer")).toHaveTextContent(/3:00|2:59|2:58/);
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

  it("closes the actions on Cancel", async () => {
    // Delete lives in the edit sheet now (F9); Cancel replaced the strip's Keep.
    threeSets();
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 3" });
    await user.click(screen.getByRole("group", { name: "Set 2" }));
    await user.click(screen.getByRole("button", { name: "Cancel, keep Set 2 as logged" }));
    expect(screen.queryByRole("button", { name: "Delete Set 2" })).not.toBeInTheDocument();
    expect(removeSet).not.toHaveBeenCalled();
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

  it("lays out every prescribed set at once, so Set 2 is waiting with its target (F5)", async () => {
    const { user } = setup({ active: session({ programDayId: "d1" }) });
    await screen.findByRole("group", { name: "Set 1" });
    const squatBlock = screen.getByRole("region", { name: "Squat" });
    expect(within(squatBlock).getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    // Nothing new is invented on the confirm: Set 2 was already there.
    expect(within(squatBlock).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Set 1", "Set 2"]);
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
    expect(logSet.mock.calls[1][0]).toMatchObject({ loadKg: 150, reps: 5, prescriptionId: "sq", setIndex: 2 });

    // An extra set beyond the prescription is still one Add set away, and answers no line.
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    expect(within(squatBlock).getByRole("group", { name: "Set 3" })).toHaveTextContent("150");
    await user.click(screen.getByRole("button", { name: "Log Set 3" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(3));
    expect(logSet.mock.calls[2][0]).not.toHaveProperty("prescriptionId");
  });

  it("queues a warm-up without the coach's line, and the working set after it with it", async () => {
    // Followed past the screen into the queue: the payload here is what
    // reaches the set row. A warm-up carrying the link would count against the
    // line, so the coach's 2 x 5 would read as done one set early.
    const store = useRealQueue();
    const { user } = setup({ active: session({ programDayId: "d1" }) });
    await screen.findByRole("group", { name: "Set 1" });
    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    await user.click(screen.getByRole("switch", { name: "Warm-up" }));
    await user.click(screen.getByRole("button", { name: "Log Warm-up set" }));
    await waitFor(async () => expect(await setCreates(store)).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(async () => expect(await setCreates(store)).toHaveLength(2));

    const [warmup, working] = await setCreates(store);
    expect(warmup).toMatchObject({ sessionId: "s1", exerciseId: "squat", isWarmup: true, setIndex: 1 });
    expect(warmup).not.toHaveProperty("prescriptionId");
    expect(warmup).not.toHaveProperty("prescribed");
    expect(working).toMatchObject({
      sessionId: "s1",
      exerciseId: "squat",
      isWarmup: false,
      setIndex: 2,
      loadKg: 150,
      reps: 5,
      prescriptionId: "sq",
      prescribed: "5 reps · 150 kg (75%)",
    });
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

/* ------------------------------------------------------------------------ */

/**
 * Swaps the set-store mocks for the real module over an in-memory queue.
 *
 * No actor is attached, so nothing drains: every op the screen produced is
 * still on the store for the test to read.
 */
function useRealQueue(store: QueueStore = createMemoryStore()): QueueStore {
  resetQueueForTests(store);
  logSet.mockImplementation((input) => realSetStore.value.logSet(input as never).then(() => undefined));
  removeSet.mockImplementation((id, set) => realSetStore.value.removeSet(id, set));
  editSet.mockImplementation((id, edit, set) => realSetStore.value.editSet(id, edit as never, set));
  onTestFinished(() => resetQueueForTests());
  return store;
}

/** The set.create payloads on the store, in the order they were queued. */
async function setCreates(store: QueueStore) {
  return (await store.all())
    .filter((op) => op.kind === "set.create")
    .sort((a, b) => a.sequence - b.sequence)
    .map((op) => op.payload);
}

describe("a set followed into the queue", () => {
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const enterSet = async (user: ReturnType<typeof userEvent.setup>, kg: string, reps: string) => {
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of [...kg]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    for (const key of [...reps]) await user.click(screen.getByRole("button", { name: key }));
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not reuse a set index freed by a delete on this page", async () => {
    // set_index is one past the highest this page has seen, deleted sets
    // included. Counted from what is still shown, the next set would take the
    // deleted one's number, and History would show two set 2s if the delete
    // and the create landed in either order.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const store = useRealQueue();
    const { user } = setup({ active: session() }, { advanceTimers: vi.advanceTimersByTime });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(async () => expect(await setCreates(store)).toHaveLength(2));

    await user.click(screen.getByRole("group", { name: "Set 2" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 2" }));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 10);
    });
    // Never sent, so the delete took the create back out of the queue.
    await waitFor(async () => expect((await setCreates(store)).map((p) => p.setIndex)).toEqual([1]));

    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(async () => expect(await setCreates(store)).toHaveLength(2));
    expect((await setCreates(store)).map((p) => p.setIndex)).toEqual([1, 3]);
  });

  describe("tapping on while the write is still reaching the phone", () => {
    // The e2e session and offline scripts, step for step, over a queue whose
    // disk takes 50ms a write -- real IndexedDB is slower than a Map, and the
    // e2e taps land inside that window.
    const useSlowDisk = () => {
      const inner = createMemoryStore();
      return useRealQueue({
        put: async (op) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          await inner.put(op);
        },
        remove: inner.remove,
        all: inner.all,
      });
    };
    const warmUpThenWorkingSet = async (user: ReturnType<typeof userEvent.setup>) => {
      await addSquat(user);
      await enterSet(user, "60", "5");
      await user.click(screen.getByRole("switch", { name: "Warm-up" }));
      await user.click(screen.getByRole("button", { name: "Log Warm-up set" }));
      await screen.findByRole("group", { name: "Warm-up set" });
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      await enterSet(user, "140", "5");
      await user.click(screen.getByRole("button", { name: "Set 1 RPE" }));
      await user.click(screen.getByRole("button", { name: "8" }));
    };

    it("adds no Set 2 until one is asked for (e2e-session)", async () => {
      const store = useSlowDisk();
      const { user } = setup({ active: session() });
      await warmUpThenWorkingSet(user);
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(2));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
      });

      expect(screen.queryAllByRole("group", { name: "Set 2" })).toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      expect(await screen.findByRole("group", { name: "Set 2" })).toHaveTextContent("140");
      await user.click(screen.getByRole("button", { name: "Log Set 2" }));
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(3));
      expect((await setCreates(store)).map((p) => [p.loadKg, p.isWarmup])).toEqual([
        [60, true],
        [140, false],
        [140, false],
      ]);
    });

    it("starts the rest when a set is logged with the planned row behind it already edited (e2e-session)", async () => {
      const store = useSlowDisk();
      const { user } = setup({ active: session() });
      await addSquat(user);
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
      for (const key of ["1", "6", "0"]) await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Reps" }));
      await user.click(screen.getByRole("button", { name: "3" }));
      await user.click(screen.getByRole("button", { name: "Set 1 RPE" }));
      await user.click(screen.getByRole("button", { name: "9" }));
      await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
      for (const key of ["1", "0", "0"]) await user.click(screen.getByRole("button", { name: key }));
      expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("100");

      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await screen.findByRole("button", { name: "Log Set 2" });
      expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("100");
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(1));
      // Within a frame or two of the write landing, not "eventually".
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(screen.getByRole("timer", { name: "Rest timer" })).toBeInTheDocument();
    });

    it("offers Log Set 2 when Add set is tapped before Set 1 has landed (e2e-offline)", async () => {
      const store = useSlowDisk();
      const { user } = setup({ active: session() });
      await warmUpThenWorkingSet(user);
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      // No wait: straight on, inside the write.
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));

      expect(await screen.findByRole("group", { name: "Set 2" })).toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "Log Set 2" }));
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(3));
      expect(screen.queryAllByRole("group", { name: "Set 3" })).toHaveLength(0);
    });
  });

  it("keeps a set the phone could not store off the screen and out of the queue, and says so", async () => {
    // The whole path with the real queue: IndexedDB refuses the write.
    const inner = createMemoryStore();
    const disk = { full: true };
    const store = useRealQueue({
      put: (op) => (disk.full ? Promise.reject(new DOMException("Quota exceeded", "QuotaExceededError")) : inner.put(op)),
      remove: inner.remove,
      all: inner.all,
    });
    const { user } = setup({ active: session() });
    await addSquat(user);
    await enterSet(user, "140", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/wasn.t saved/);
    expect(await setCreates(store)).toEqual([]);
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();

    disk.full = false;
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(async () => expect(await setCreates(store)).toHaveLength(1));
    expect((await setCreates(store))[0]).toMatchObject({ loadKg: 140, reps: 5 });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("brings a deleted set back when the device cannot write the delete down", async () => {
    // Storage full or blocked: the delete exists nowhere, so the set is still
    // logged. Leaving it hidden would show the athlete a session that is not
    // the one their coach will see.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inner = createMemoryStore();
    const disk = { full: false };
    const refuse = () => Promise.reject(new DOMException("Quota exceeded", "QuotaExceededError"));
    const store = useRealQueue({
      put: (op) => (disk.full ? refuse() : inner.put(op)),
      remove: (id) => (disk.full ? refuse() : inner.remove(id)),
      all: inner.all,
    });
    storedSets.value = [logged("a", 140, 30, { setIndex: 1 }), logged("b", 150, 10, { setIndex: 2 })];
    const { user } = setup({ active: session() }, { advanceTimers: vi.advanceTimersByTime });
    await screen.findByRole("group", { name: "Set 2" });

    disk.full = true;
    await user.click(screen.getByRole("group", { name: "Set 2" }));
    await user.click(screen.getByRole("button", { name: "Delete Set 2" }));
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 10);
    });

    expect(await screen.findByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    expect(removeSet).toHaveBeenCalledWith("b", expect.objectContaining({ exerciseId: "squat" }));
    expect((await store.all()).filter((op) => op.kind === "set.delete")).toEqual([]);
  });
});

describe("an athlete who reads pounds", () => {
  // The kg/lb preference used to change nothing: 225 typed by an athlete who
  // had picked Pounds was stored as 225 kg (test audit 9 Oct 2026, B3).
  beforeEach(() => {
    profile.units = "lb";
  });

  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const press = async (user: ReturnType<typeof userEvent.setup>, keys: string) => {
    for (const key of [...keys]) {
      await user.click(screen.getByRole("button", { name: key === "." ? "Decimal point" : key }));
    }
  };

  it("stores 225 lb typed on the pad as its kilos, not as 225 kg", async () => {
    const { user } = setup({ active: session(), withUnits: true });
    await addSquat(user);

    await user.click(await screen.findByRole("button", { name: "Set 1 weight in pounds" }));
    expect(screen.getByText("Weight, lb")).toBeInTheDocument();
    await press(user, "225");
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await press(user, "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ loadKg: 102.058, reps: 5 });
    // And reads back as exactly what was typed.
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("225");
  });

  it("prefills the next set in pounds, so a straight set needs nothing typed and nothing drifts", async () => {
    const { user } = setup({ active: session(), withUnits: true });
    await addSquat(user);
    await user.click(await screen.findByRole("button", { name: "Set 1 weight in pounds" }));
    await press(user, "225");
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await press(user, "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));

    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("225");
    // Opening the pad on it starts from the same 225, not from its kilos.
    await user.click(screen.getByRole("button", { name: "Set 2 weight in pounds" }));
    expect(screen.getByRole("status")).toHaveTextContent("225");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
    expect(logSet.mock.calls[1][0]).toMatchObject({ loadKg: 102.058 });
  });

  it("shows sets already logged in kilos as pounds", async () => {
    storedSets.value = [
      { exerciseId: "squat", clientSetId: "a", loadKg: 100, reps: 5, rpe: 8, isWarmup: false, loggedAt: new Date() },
    ];
    setup({ active: session(), withUnits: true });
    const row = await screen.findByRole("group", { name: "Set 1" });
    await waitFor(() => expect(row).toHaveTextContent("220.5"));
  });
});

/* ------------------------------------------------------------------------ */
/* Owner's Log Session feedback, Oct 2026                                   */
/* ------------------------------------------------------------------------ */

describe("the rest timer at zero", () => {
  const withVibrate = () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
    return vibrate;
  };
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });

  it("dismisses itself when it reaches zero, and buzzes once", async () => {
    const vibrate = withVibrate();
    rememberRest({ startedAt: new Date(Date.now() - 119_000), restMs: 120_000 });
    setup({ active: session() });
    expect(await screen.findByRole("timer")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole("timer")).not.toBeInTheDocument(), { timeout: 3_000 });
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([...REST_BUZZ]);
    // Gone from storage too, so a reload does not bring it back.
    expect(localStorage.getItem("snb.rest-timer")).toBeNull();
    // And the bottom of the screen goes back to adding an exercise.
    expect(screen.getByRole("combobox", { name: "Add exercise" })).toBeInTheDocument();
  });

  it("never shows a negative number on the way down", async () => {
    rememberRest({ startedAt: new Date(Date.now() - 119_500), restMs: 120_000 });
    setup({ active: session() });
    const timer = screen.queryByRole("timer");
    if (timer) expect(timer.textContent).not.toMatch(/-/);
    await waitFor(() => expect(screen.queryByRole("timer")).not.toBeInTheDocument(), { timeout: 3_000 });
  });

  it("comes back dismissed after a reload past the end, without buzzing", async () => {
    const vibrate = withVibrate();
    rememberRest({ startedAt: new Date(Date.now() - 5 * 60_000), restMs: 120_000 });
    setup({ active: session() });
    await screen.findByRole("combobox", { name: "Add exercise" });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("does not throw on a phone with no vibration", async () => {
    rememberRest({ startedAt: new Date(Date.now() - 119_000), restMs: 120_000 });
    setup({ active: session() });
    await waitFor(() => expect(screen.queryByRole("timer")).not.toBeInTheDocument(), { timeout: 3_000 });
  });
});

describe("adding an exercise mid-rest", () => {
  const bench: Exercise = { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true };

  const logSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("combobox", { name: "Add exercise" }));
    await user.click(await screen.findByRole("option", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of ["1", "4", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
  };

  it("opens the box from the end of the list without skipping the rest", async () => {
    library.exercises = [squat, bench];
    const { user } = setup({ active: session() });
    await logSquat(user);
    expect(await screen.findByRole("timer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add exercise" }));
    // The rest stays where it was; the box opens in the list.
    expect(screen.getByRole("timer")).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "Add exercise" }), "bench");
    await user.click(await screen.findByRole("option", { name: "Bench Press" }));

    expect(await screen.findByRole("region", { name: "Bench Press" })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    // Picked, so the box closes and the button is back.
    expect(screen.queryByRole("combobox", { name: "Add exercise" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add exercise" })).toBeInTheDocument();
  });

  it("only ever shows one Add exercise box", async () => {
    const { user } = setup({ active: session() });
    // Nothing holds the bottom: the box is there, and no button duplicates it.
    expect(screen.getByRole("combobox", { name: "Add exercise" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add exercise" })).not.toBeInTheDocument();

    await logSquat(user);
    await user.click(await screen.findByRole("button", { name: "+ Add exercise" }));
    expect(screen.getAllByRole("combobox", { name: "Add exercise" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("combobox", { name: "Add exercise" })).not.toBeInTheDocument();
  });
});

describe("removing an exercise", () => {
  const squatSets = () => {
    storedSets.value = [
      logged("a", 140, 30, { setIndex: 1 }),
      logged("b", 150, 20, { setIndex: 2 }),
      logged("w", 60, 40, { setIndex: 3, isWarmup: true }),
    ];
  };

  it("asks first, then takes the block and its sets off with one undoable toast", async () => {
    squatSets();
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });

    await user.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    expect(screen.getByText(/Its 3 logged sets will be deleted/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove exercise" }));

    expect(screen.queryByRole("region", { name: "Squat" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Squat removed · 3 sets deleted");
    expect(removeSet).not.toHaveBeenCalled();
  });

  it("deletes every set through removeSet once the undo window passes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      squatSets();
      const { user } = setup({ active: session() }, { advanceTimers: vi.advanceTimersByTime });
      await screen.findByRole("group", { name: "Set 2" });
      await user.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
      await user.click(screen.getByRole("button", { name: "Remove exercise" }));

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 10);
      });
      expect(removeSet.mock.calls.map((c) => c[0]).sort()).toEqual(["a", "b", "w"]);
      // With exercise and time, so each set's week rollup is refreshed.
      for (const call of removeSet.mock.calls) expect(call[1]).toMatchObject({ exerciseId: "squat" });
      expect(screen.queryByRole("region", { name: "Squat" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("brings the block back on Undo, and writes nothing", async () => {
    squatSets();
    const { user, unmount } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    await user.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    await user.click(screen.getByRole("button", { name: "Remove exercise" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("region", { name: "Squat" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    unmount();
    expect(removeSet).not.toHaveBeenCalled();
  });

  it("keeps the session's totals honest at finish", async () => {
    squatSets();
    const { user, finish } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    await user.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    await user.click(screen.getByRole("button", { name: "Remove exercise" }));
    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(removeSet).toHaveBeenCalledTimes(3);
    expect(finish).toHaveBeenCalledWith("s1", { setCount: 0, tonnageKg: 0 });
  });

  it("takes the rest down when the block holds the set it was for, and Undo restores it", async () => {
    squatSets();
    rememberRest({ startedAt: new Date(), restMs: 120_000 });
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    await user.click(screen.getByRole("button", { name: "Remove exercise" }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("removes an exercise with nothing logged straight away, still undoable", async () => {
    const { user } = setup({ active: session() });
    await user.click(screen.getByRole("combobox", { name: "Add exercise" }));
    await user.click(await screen.findByRole("option", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: "Remove Squat from this session" }));

    expect(screen.queryByRole("region", { name: "Squat" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Squat removed");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    // Its planned row comes back with it.
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeInTheDocument();
  });

  it("refuses when the coach has commented on one of its sets, and says why", async () => {
    squatSets();
    comments.value = [{ setId: "b", authorId: "coach_ruairi" }];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Squat from this session" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Remove Squat from this session" }));
    expect(await screen.findByText(/Your coach has commented on a set here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove exercise" })).not.toBeInTheDocument();
  });
});

describe("the pad's steppers", () => {
  it("steps the load by 2.5 kg and the reps by 1, into the row", async () => {
    const { user } = setup({ active: session() });
    await user.click(screen.getByRole("combobox", { name: "Add exercise" }));
    await user.click(await screen.findByRole("option", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of ["1", "4", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Increase weight by 2.5 kg" }));
    await user.click(screen.getByRole("button", { name: "Increase weight by 2.5 kg" }));
    await user.click(screen.getByRole("button", { name: "Decrease weight by 2.5 kg" }));
    expect(screen.getByRole("button", { name: /weight in kilograms/ })).toHaveTextContent("142.5");

    await user.click(screen.getByRole("button", { name: "Reps" }));
    expect(screen.getByRole("button", { name: "Decrease reps by 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Increase reps by 1" }));
    await user.click(screen.getByRole("button", { name: "Increase reps by 1" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    expect(logSet).toHaveBeenCalledWith(expect.objectContaining({ loadKg: 142.5, reps: 2 }));
  });
});

describe("this week, on the Log landing", () => {
  const thisWeek = weekStart(new Date()).toISOString();

  it("sums this week's rollups and counts finished sessions, above Start", async () => {
    weekRollups.value = [
      { weekStart: thisWeek, setCount: 6, tonnageKg: 4200 },
      { weekStart: thisWeek, setCount: 4, tonnageKg: 1800 },
    ];
    const done = session({ id: "old", startedAt: new Date(), finishedAt: new Date() });
    setup({ state: { status: "ready", sessions: [done] } });

    const card = await screen.findByRole("region", { name: "This week" });
    await waitFor(() => expect(within(card).getByText("10")).toBeInTheDocument());
    expect(within(card).getByText("6000")).toBeInTheDocument();
    expect(within(card).getByText("1")).toBeInTheDocument();
    // Above the Start button, in document order.
    const start = screen.getByRole("button", { name: "Start a session" });
    expect(card.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says so for an empty week rather than showing a row of zeros alone", async () => {
    setup();
    expect(await screen.findByText("Nothing logged yet this week.")).toBeInTheDocument();
  });

  it("keeps the session count and dashes the totals with no signal", async () => {
    weekRollups.fail = true;
    const done = session({ id: "old", startedAt: new Date(), finishedAt: new Date() });
    setup({ state: { status: "ready", sessions: [done] } });
    expect(await screen.findByText(/Set totals load when there/)).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "This week" });
    expect(within(card).getAllByText("—")).toHaveLength(2);
    expect(within(card).getByText("1")).toBeInTheDocument();
  });

  it("is not shown once a session is running", () => {
    setup({ active: session() });
    expect(screen.queryByRole("region", { name: "This week" })).not.toBeInTheDocument();
  });
});

describe("the keypad sheet", () => {
  const sheet = () => document.querySelector("[data-log-sheet]");
  const openPad = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("combobox", { name: "Add exercise" }));
    await user.click(await screen.findByRole("option", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
  };

  it("opens the pad in the pinned sheet, after End session rather than under it in the footer", async () => {
    const { user } = setup({ active: session() });
    expect(sheet()).toBeNull();
    await openPad(user);

    const pad = screen.getByRole("region", { name: "Weight, kg keypad" });
    expect(sheet()).toContainElement(pad);
    // The sheet is the last thing on the page, so it sticks over whatever is
    // below the row, and the content above can scroll clear of it.
    const end = screen.getByRole("button", { name: "End session" });
    expect(end.compareDocumentPosition(sheet()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sheet()!.className).toContain("sticky");
    expect(sheet()!.className).toContain("motion-safe:animate-sheet-in");
  });

  it("closes on Done, and the warm-up switch inside it still flags the row", async () => {
    const { user } = setup({ active: session() });
    await openPad(user);
    const toggle = screen.getByRole("switch", { name: "Warm-up" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("group", { name: "Warm-up set" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(sheet()).toBeNull();
    expect(screen.queryByRole("region", { name: /keypad/ })).not.toBeInTheDocument();
  });

  it("swaps the pad for RPE inside the same sheet, without closing it", async () => {
    const { user } = setup({ active: session() });
    await openPad(user);
    const host = sheet();
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "RPE" }));

    expect(screen.getByRole("region", { name: "RPE for set 1" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /keypad/ })).not.toBeInTheDocument();
    expect(sheet()).toBe(host);
    await user.click(screen.getByRole("button", { name: "8" }));
    expect(sheet()).toBeNull();
  });

  it("holds the bottom alone: the rest bar steps aside while it is up and comes back after", async () => {
    const { user } = setup({ active: session() });
    await openPad(user);
    for (const key of ["1", "4", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    expect(await screen.findByRole("timer", { name: "Rest timer" })).toBeInTheDocument();
    // The rest now rides in the same sheet (F5), in place of the pad.
    expect(sheet()).toContainElement(screen.getByRole("timer", { name: "Rest timer" }));
    expect(screen.queryByRole("region", { name: /keypad/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
    expect(screen.getByRole("region", { name: "Weight, kg keypad" })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("timer", { name: "Rest timer" })).toBeInTheDocument();
  });

  it("gives way to the finish confirm", async () => {
    const { user } = setup({ active: session() });
    await openPad(user);
    await user.click(screen.getByRole("button", { name: "End session" }));
    expect(sheet()).toBeNull();
    expect(screen.getByRole("button", { name: "Keep going" })).toBeInTheDocument();
  });

  describe("scrolling the row clear of it", () => {
    const SHEET_PX = 380;
    const VIEWPORT = { top: 0, bottom: 852 };
    let rowRect = { top: 700, bottom: 764 };
    let scrollBy: ReturnType<typeof vi.fn>;
    let reduced = false;

    beforeEach(() => {
      rowRect = { top: 700, bottom: 764 };
      reduced = false;
      scrollBy = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, value: scrollBy });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-log-sheet") ? SHEET_PX : 0;
      });
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const box = this.tagName === "MAIN" ? VIEWPORT : this.getAttribute("role") === "group" ? rowRect : VIEWPORT;
        return { ...box, left: 0, right: 390, width: 390, height: box.bottom - box.top, x: 0, y: box.top } as DOMRect;
      });
      vi.stubGlobal(
        "matchMedia",
        (query: string) => ({ matches: reduced && query.includes("reduce"), media: query }) as MediaQueryList,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy;
    });

    it("scrolls <main> so the row sits just above the sheet when the pad opens", async () => {
      const { user } = setup({ active: session(), inMain: true });
      await openPad(user);
      // 852 viewport - 380 sheet - 12 gap = 460 visible; the row's bottom is at 764.
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 764 - 460, behavior: "smooth" });
      expect(scrollBy.mock.contexts.at(-1)).toBe(document.querySelector("main"));
    });

    it("scrolls again when focus moves to another field, and not when the row is already clear", async () => {
      const { user } = setup({ active: session(), inMain: true });
      await openPad(user);
      const calls = scrollBy.mock.calls.length;
      rowRect = { top: 900, bottom: 964 };
      await user.click(screen.getByRole("button", { name: "Reps" }));
      expect(scrollBy).toHaveBeenCalledTimes(calls + 1);
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 964 - 460, behavior: "smooth" });

      rowRect = { top: 200, bottom: 264 };
      await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
      expect(scrollBy).toHaveBeenCalledTimes(calls + 1);
    });

    it("jumps instead of gliding under reduced motion", async () => {
      reduced = true;
      const { user } = setup({ active: session(), inMain: true });
      await openPad(user);
      expect(scrollBy).toHaveBeenLastCalledWith({ top: 304, behavior: "auto" });
    });
  });
});

describe("the set number flips warm-up (Set Row, F2)", () => {
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };

  it("flips a logged set through History's edit path, and renumbers the rest", async () => {
    storedSets.value = [logged("a", 60, 30, { rpe: 6 }), logged("b", 140, 20, { rpe: 8 })];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });

    await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));

    expect(editSet).toHaveBeenCalledTimes(1);
    expect(editSet.mock.calls[0][0]).toBe("a");
    // A warm-up carries no RPE, so the stored e1RM goes with it.
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 60, reps: 5, rpe: null, isWarmup: true, failed: false });
    expect(editSet.mock.calls[0][2]).toMatchObject({ exerciseId: "squat" });
    expect(screen.getByRole("group", { name: "Warm-up set" })).toHaveTextContent("60");
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
  });

  it("gives a set flipped back on this page its RPE back", async () => {
    storedSets.value = [logged("a", 140, 20, { rpe: 8 })];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 1" });
    await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));
    expect(screen.getByLabelText("Warm-up set RPE")).toHaveTextContent("—");

    await user.click(screen.getByRole("button", { name: "Warm-up set: make it a working set" }));
    expect(editSet.mock.calls[1][1]).toEqual({ loadKg: 140, reps: 5, rpe: 8, isWarmup: false, failed: false });
    expect(screen.getByLabelText("Set 1 RPE")).toHaveTextContent("8");
  });

  it("puts the row back when the phone could not store the flip", async () => {
    storedSets.value = [logged("a", 140, 20)];
    editSet.mockRejectedValueOnce(new Error("QuotaExceededError"));
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 1" });
    await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));
    expect(await screen.findByRole("group", { name: "Set 1" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Warm-up set" })).not.toBeInTheDocument();
  });

  it("flips a row not logged yet in place, and it logs as a warm-up", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));
    expect(screen.getByRole("group", { name: "Warm-up set" })).toBeInTheDocument();
    // Nothing logged, so nothing to edit.
    expect(editSet).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Warm-up set weight in kilograms" }));
    for (const key of "60") await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Warm-up set" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ isWarmup: true, loadKg: 60, reps: 5 });
  });

  it("moves the coach's next target back when a logged working set becomes a warm-up", async () => {
    library.exercises = [squat];
    prescribed.value = {
      status: "ready",
      day: {
        program: { id: "p1" },
        week: { id: "w1" },
        day: { id: "d1", label: "Day 1", notes: null },
        prescriptions: [
          {
            id: "sq", exerciseId: "squat", position: 0, setCount: 2, reps: 5, load: "75%",
            programId: "p1", weekId: "w1", dayId: "d1", repMax: null, restSeconds: null, notes: null,
            loadKind: null, updatedAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
      maxes: {
        entries: [
          { id: "m1", exerciseId: "squat", kind: "training", valueKg: 200, effectiveFrom: "2026-01-01T00:00:00Z", recordedBy: "coach" },
        ],
        estimated: new Map(),
      },
    };
    storedSets.value = [logged("a", 150, 20, { setIndex: 1 })];
    const { user } = setup({ active: session({ programDayId: "d1" }) });
    const prescribedList = await screen.findByRole("list", { name: "Squat prescribed" });
    expect(prescribedList).toHaveTextContent("Next: Set 2 of 2");

    await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));
    expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 1 of 2");
  });

  it("removes a planned row with a swipe, the × gone", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    expect(screen.queryByText("×")).not.toBeInTheDocument();
    const second = screen.getByRole("group", { name: "Set 2" });
    fireEvent.pointerDown(second, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(second, { clientX: 150, clientY: 10 });
    fireEvent.pointerUp(second);
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toBeInTheDocument();
  });

  it("queues the flip behind the set's own create, and a reload with no signal still shows it", async () => {
    const store = useRealQueue();
    const { user, unmount } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    for (const key of "60") await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(async () => expect(await setCreates(store)).toHaveLength(1));
    await screen.findByRole("button", { name: "Set 1: mark as warm-up" });
    // Wait out the write reaching the phone (logSet queues the rollup refresh
    // last): a flip is refused until then.
    await waitFor(async () => expect((await store.all()).some((op) => op.kind === "rollup.refresh")).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));

    await waitFor(async () => {
      const ops = (await store.all()).sort((a, b) => a.sequence - b.sequence);
      const create = ops.find((op) => op.kind === "set.create");
      const edit = ops.find((op) => op.kind === "set.update");
      expect(edit?.payload).toMatchObject({ setId: create?.payload.setId, isWarmup: true, rpe: null });
      expect(edit!.sequence).toBeGreaterThan(create!.sequence);
    });

    // The reload: the create still says working; the queued edit wins.
    unmount();
    setup({ active: session() });
    expect(await screen.findByRole("group", { name: "Warm-up set" })).toHaveTextContent("60");
  });
});

/* ------------------------------------------------------------------------ */

describe("following a coach's program (F5)", () => {
  const barbellRow: Exercise = { id: "bb-row", name: "Barbell Row", normalisedName: "barbell row", isGlobal: true };
  const dumbbellRow: Exercise = { id: "db-row", name: "Dumbbell Row", normalisedName: "dumbbell row", isGlobal: true };
  const cableRaise: Exercise = { id: "c-raise", name: "Cable Front Raise", normalisedName: "cable front raise", isGlobal: true };
  const plateRaise: Exercise = { id: "p-raise", name: "Plate Front Raise", normalisedName: "plate front raise", isGlobal: true };

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
    library.exercises = [squat, barbellRow, dumbbellRow, cableRaise, plateRaise];
    prescribed.value = {
      status: "ready",
      day: {
        program: { id: "p1" },
        week: { id: "w1" },
        day: { id: "d1", label: "Day 1", notes: null },
        prescriptions: [
          line({
            id: "sq", exerciseId: "squat", position: 0, setCount: 2, reps: 5, load: "75%",
            warmupSets: 2, pauseSeconds: 2, videoRequired: true,
          }),
          line({ id: "row", exerciseId: "bb-row", position: 1, setCount: 3, reps: 8, load: "60" }),
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

  const rowsIn = (block: HTMLElement) => within(block).queryAllByRole("group").map((g) => g.getAttribute("aria-label"));
  const squatBlock = () => screen.getByRole("region", { name: "Squat" });
  const dropWarmups = async (user: ReturnType<typeof userEvent.setup>) => {
    for (const remove of screen.getAllByRole("button", { name: "Remove planned Warm-up set" })) await user.click(remove);
  };
  const reload = (unmount: () => void) => {
    unmount();
    return setup({ active: session({ programDayId: "d1" }) });
  };

  describe("laying out the prescribed sets", () => {
    it("lays out the warm-ups blank, then every working set priced to the coach's line", async () => {
      setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Warm-up set", "Set 1", "Set 2"]);
      const [w1, w2] = within(squatBlock()).getAllByRole("group", { name: "Warm-up set" });
      for (const warmup of [w1, w2]) {
        expect(within(warmup).getByRole("button", { name: "Warm-up set weight in kilograms" })).toHaveTextContent("KG");
        expect(within(warmup).getByRole("button", { name: "Warm-up set reps" })).toHaveTextContent("REPS");
      }
      expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("150");
      expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    });

    it("slides the laid-out rows in on the row-in token", async () => {
      setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      const arrived = squatBlock().querySelectorAll("[data-arrived]");
      expect(arrived).toHaveLength(4);
      for (const el of arrived) expect(el.className).toContain("motion-safe:animate-row-in");
    });

    it("lays out the next exercise's sets only when it is opened, and keeps the first's", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      const rowBlock = screen.getByRole("region", { name: "Barbell Row" });
      expect(rowsIn(rowBlock)).toEqual([]);
      await user.click(within(rowBlock).getByRole("button", { name: "Barbell Row" }));
      expect(rowsIn(rowBlock)).toEqual(["Set 1", "Set 2", "Set 3"]);
      expect(within(rowBlock).getByRole("group", { name: "Set 3" })).toHaveTextContent("60");
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Warm-up set", "Set 1", "Set 2"]);
    });

    it("logs warm-ups with no line and working sets with the line and its pause, in order", async () => {
      const store = useRealQueue();
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      // First warm-up: the athlete's own ramp.
      await user.click(within(squatBlock()).getAllByRole("button", { name: "Warm-up set weight in kilograms" })[0]);
      for (const key of ["6", "0"]) await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Reps" }));
      await user.click(screen.getByRole("button", { name: "5" }));
      await user.click(within(squatBlock()).getAllByRole("button", { name: "Log Warm-up set" })[0]);
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(1));
      // The second warm-up is skipped; the working sets are already priced.
      await dropWarmups(user);
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(2));

      const [warmup, working] = await setCreates(store);
      expect(warmup).toMatchObject({ exerciseId: "squat", isWarmup: true, loadKg: 60, reps: 5, setIndex: 1 });
      expect(warmup).not.toHaveProperty("prescriptionId");
      expect(working).toMatchObject({
        exerciseId: "squat",
        isWarmup: false,
        loadKg: 150,
        reps: 5,
        setIndex: 2,
        prescriptionId: "sq",
        prescribed: "5 reps · 2s pause · 150 kg (75%)",
      });
    });

    it("keeps numbering and the next target right as the laid-out rows are logged", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await dropWarmups(user);
      expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 1 of 2");
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 2 of 2");
      expect(rowsIn(squatBlock())).toEqual(["Set 1", "Set 2"]);
      expect(screen.getByRole("button", { name: "Log Set 2" })).toBeEnabled();
    });

    it("still removes a laid-out row with a swipe", async () => {
      setup({ active: session({ programDayId: "d1" }) });
      const second = await screen.findByRole("group", { name: "Set 2" });
      fireEvent.pointerDown(second, { clientX: 300, clientY: 10 });
      fireEvent.pointerMove(second, { clientX: 150, clientY: 10 });
      fireEvent.pointerUp(second);
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Warm-up set", "Set 1"]);
    });

    it("shows the pause and the warm-ups in the coach's line above the rows", async () => {
      setup({ active: session({ programDayId: "d1" }) });
      const list = await screen.findByRole("list", { name: "Squat prescribed" });
      expect(list).toHaveTextContent("2 × 5 · 2s pause · 150 kg (75%) · +2 warm-up · video requested");
    });
  });

  describe("rows laid out ahead of the sets they follow", () => {
    const rpeDay = (extra: Record<string, unknown> = {}) => {
      prescribed.value = {
        ...(prescribed.value as Record<string, unknown>),
        day: {
          program: { id: "p1" },
          week: { id: "w1" },
          day: { id: "d1", label: "Day 1", notes: null },
          prescriptions: [line({ id: "top", exerciseId: "squat", position: 0, setCount: 2, reps: 3, load: "@8", ...extra })],
        },
      };
    };
    const logTop = async (user: ReturnType<typeof userEvent.setup>, kg: string) => {
      await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
      for (const key of [...kg]) await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Reps" }));
      await user.click(screen.getByRole("button", { name: "RPE" }));
      await user.click(screen.getByRole("button", { name: "8" }));
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    };

    it("repeats an RPE line's first set into the untouched second, so a straight set is one tap", async () => {
      rpeDay();
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      expect(await screen.findByRole("group", { name: "Set 2" })).toHaveTextContent("KG");
      await logTop(user, "180");
      expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("180");
      expect(screen.getByRole("button", { name: "Log Set 2" })).toBeEnabled();
    });

    it("prices a backoff laid out before its top set once the top set is logged", async () => {
      rpeDay({ setCount: 1, backoff: "2 x 90%" });
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 3" });
      await logTop(user, "180");
      // 90% of 180, floored to the plates: 160.
      expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("160");
      expect(screen.getByRole("group", { name: "Set 3" })).toHaveTextContent("160");
      expect(screen.getAllByText("backoff from top set 180 × 3")).toHaveLength(2);
    });

    it("leaves a row the athlete has typed into alone", async () => {
      rpeDay();
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 2" });
      await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
      for (const key of ["1", "7", "5"]) await user.click(screen.getByRole("button", { name: key }));
      await logTop(user, "180");
      expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("175");
    });
  });

  describe("after a reload", () => {
    it("lays out only what is left: no warm-ups for a line under way, and the right next set", async () => {
      storedSets.value = [
        logged("w", 60, 12, { isWarmup: true, setIndex: 1 }),
        logged("a", 150, 10, { setIndex: 2, prescriptionId: "sq" }),
      ];
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      // A reload opens nothing by itself: the first tap on the name lays it out.
      expect(within(squatBlock()).queryByRole("button", { name: /^Log/ })).not.toBeInTheDocument();
      await user.click(within(squatBlock()).getByRole("button", { name: "Squat" }));
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Set 1", "Set 2"]);
      expect(screen.getByRole("button", { name: "Log Set 2" })).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 2 of 2");
    });

    it("owes only the warm-ups not logged yet when no working set has been", async () => {
      storedSets.value = [logged("w", 60, 12, { isWarmup: true, setIndex: 1 })];
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Warm-up set" });
      await user.click(within(squatBlock()).getByRole("button", { name: "Squat" }));
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Warm-up set", "Set 1", "Set 2"]);
      expect(within(squatBlock()).getAllByRole("button", { name: /^Log/ })).toHaveLength(1);
    });

    it("picks up from the queue with no signal, and the next set lands once with the right index", async () => {
      const store = useRealQueue();
      const first = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await dropWarmups(first.user);
      await first.user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(1));

      // Reloaded in the basement: Appwrite cannot be read, the queue is all there is.
      storedSets.fail = 1_000;
      const { user } = reload(first.unmount);
      await waitFor(() => expect(within(squatBlock()).getAllByRole("group")).toHaveLength(1));
      expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 2 of 2");
      await user.click(within(squatBlock()).getByRole("button", { name: "Squat" }));
      expect(rowsIn(squatBlock())).toEqual(["Set 1", "Set 2"]);
      await user.click(screen.getByRole("button", { name: "Log Set 2" }));
      await waitFor(async () => expect(await setCreates(store)).toHaveLength(2));
      const creates = await setCreates(store);
      expect(creates[1]).toMatchObject({ setIndex: 2, loadKg: 150, prescriptionId: "sq" });
      expect(new Set(creates.map((c) => c.setId)).size).toBe(2);
    });
  });

  describe("waiting for the session's sets before laying anything out", () => {
    const holdRead = () => {
      let release!: () => void;
      storedSets.hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return async () => {
        await act(async () => {
          release();
          await storedSets.hold;
        });
      };
    };
    const settle = () =>
      act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });

    it("lays out nothing on a resumed session while its sets are still loading, and nothing stale after", async () => {
      storedSets.value = [
        logged("w", 60, 12, { isWarmup: true, setIndex: 1 }),
        logged("a", 150, 10, { setIndex: 2, prescriptionId: "sq" }),
      ];
      const release = holdRead();
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await settle();
      // The read is still out: the block is listed, but no row is laid out.
      expect(rowsIn(squatBlock())).toEqual([]);
      expect(screen.queryByRole("button", { name: /^Log / })).not.toBeInTheDocument();

      await release();
      await screen.findByRole("group", { name: "Set 1" });
      await settle();
      // Only what was logged: no warm-up rows for a line under way, ever.
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Set 1"]);
      expect(screen.queryByRole("button", { name: /^Log / })).not.toBeInTheDocument();
      await user.click(within(squatBlock()).getByRole("button", { name: "Squat" }));
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Set 1", "Set 2"]);
    });

    it("opens a fresh prescribed session as soon as the slow read comes back empty", async () => {
      const release = holdRead();
      setup({ active: session({ programDayId: "d1" }) });
      await settle();
      expect(rowsIn(squatBlock())).toEqual([]);
      await release();
      expect(await screen.findByRole("button", { name: "Log Warm-up set" })).toBeInTheDocument();
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Warm-up set", "Set 1", "Set 2"]);
    });

    it("opens at once when the session's own create is still queued, without waiting on a hung read", async () => {
      useRealQueue();
      await act(async () => {
        await enqueue("session.create", { sessionId: "s1", startedAt: new Date().toISOString(), programDayId: "d1" });
      });
      holdRead(); // never released: gym wifi that routes nowhere
      setup({ active: session({ programDayId: "d1" }) });
      expect(await screen.findByRole("group", { name: "Set 1" })).toBeInTheDocument();
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Warm-up set", "Set 1", "Set 2"]);
    });

    it("trusts the queue when the read fails: queued sets mean resumed, so nothing opens", async () => {
      const store = useRealQueue();
      await act(async () => {
        await realSetStore.value.logSet({
          sessionId: "s1", exerciseId: "squat", setIndex: 1, loadKg: 150, reps: 5, rpe: null,
          isWarmup: false, failed: false, clientSetId: "q1", prescriptionId: "sq", prescribed: "5 reps · 2s pause · 150 kg (75%)",
        });
      });
      expect((await store.all()).length).toBeGreaterThan(0);
      storedSets.fail = 1_000;
      setup({ active: session({ programDayId: "d1" }) });
      expect(await screen.findByRole("group", { name: "Set 1" })).toBeInTheDocument();
      await settle();
      expect(rowsIn(squatBlock())).toEqual(["Set 1"]);
      expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 2 of 2");
    });

    it("opens a fresh session whose read fails with nothing queued", async () => {
      storedSets.fail = 1_000;
      setup({ active: session({ programDayId: "d1" }) });
      expect(await screen.findByRole("group", { name: "Set 1" })).toBeInTheDocument();
      expect(rowsIn(squatBlock())).toEqual(["Warm-up set", "Warm-up set", "Set 1", "Set 2"]);
    });
  });

  describe("the coach's video ask", () => {
    it("badges the planned working sets of the flagged line before they are logged, not the warm-ups", async () => {
      setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      expect(screen.getByRole("img", { name: "Set 1: your coach asked for a video" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Set 2: your coach asked for a video" })).toBeInTheDocument();
      expect(within(squatBlock()).getAllByRole("img", { name: /asked for a video/ })).toHaveLength(2);
      expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent(
        "Next: Set 1 of 2 · 5 reps · 2s pause · 150 kg (75%) · film this set",
      );
    });

    it("never blocks the confirm: a flagged set logs with one tap", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await dropWarmups(user);
      expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    });

    const popup = () => screen.queryByRole("dialog", { name: "Your coach asked for a clip of this set" });

    it("keeps asking on the logged set, and the camera stands out until a clip is on", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await dropWarmups(user);
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("img", { name: "Set 1: your coach asked for a video, not filmed yet" })).toBeInTheDocument();
      expect(within(squatBlock()).getByRole("button", { name: "Add video" })).toHaveAttribute("data-video-ask", "emphasise");
      await user.click(await screen.findByRole("button", { name: "Later" }));

      await user.click(screen.getByRole("button", { name: "Log Set 2" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
      expect(within(squatBlock()).getByRole("button", { name: "Add video" })).toHaveAttribute("data-video-ask", "prompt");
      // The inline line is gone: the popup said it, once.
      expect(screen.queryByText("Your coach asked for a clip of this one.")).not.toBeInTheDocument();
      expect(within(squatBlock()).getAllByRole("img", { name: /not filmed yet/ })).toHaveLength(2);
    });

    describe("the popup after logging a requested set (F18)", () => {
      const settle = () =>
        act(async () => {
          for (let i = 0; i < 5; i++) await Promise.resolve();
        });
      // A resumed line lays out nothing by itself; the block's name opens the next row.
      const openNext = async (user: ReturnType<typeof userEvent.setup>) => {
        await screen.findByRole("group", { name: "Set 1" });
        await settle();
        await user.click(within(squatBlock()).getByRole("button", { name: "Squat" }));
        await screen.findByRole("group", { name: "Set 2" });
      };
      it("asks right after the first requested set is logged, aimed at that set, without blocking the log", async () => {
        const { user } = setup({ active: session({ programDayId: "d1" }) });
        await screen.findByRole("group", { name: "Set 1" });
        await dropWarmups(user);
        expect(popup()).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Log Set 1" }));
        // The set is written first; the question comes after.
        await waitFor(() => expect(popup()).toBeInTheDocument());
        expect(logSet).toHaveBeenCalledTimes(1);
        expect(within(popup()!).getByRole("button", { name: "Attach now" })).toBeInTheDocument();
      });

      it("asks once per exercise: Later is not followed by another popup on the next set", async () => {
        const { user } = setup({ active: session({ programDayId: "d1" }) });
        await screen.findByRole("group", { name: "Set 1" });
        await dropWarmups(user);
        await user.click(screen.getByRole("button", { name: "Log Set 1" }));
        await user.click(await screen.findByRole("button", { name: "Later" }));
        expect(popup()).not.toBeInTheDocument();
        // The badge stays as the reminder.
        expect(screen.getByRole("img", { name: "Set 1: your coach asked for a video, not filmed yet" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Log Set 2" }));
        await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
        await settle();
        expect(popup()).not.toBeInTheDocument();
      });

      it("remembers Later across a reload of the same session", async () => {
        const first = setup({ active: session({ programDayId: "d1" }) });
        await screen.findByRole("group", { name: "Set 1" });
        await dropWarmups(first.user);
        await first.user.click(screen.getByRole("button", { name: "Log Set 1" }));
        await first.user.click(await screen.findByRole("button", { name: "Later" }));

        // Back with Set 1 on the server and Set 2 still to do.
        storedSets.value = [logged("a", 150, 1, { setIndex: 1, prescriptionId: "sq" })];
        const { user } = reload(first.unmount);
        await openNext(user);
        expect(popup()).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Log Set 2" }));
        await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
        await settle();
        expect(popup()).not.toBeInTheDocument();
      });

      it("does not pop up for sets already logged when the session is reopened", async () => {
        storedSets.value = [logged("a", 150, 1, { setIndex: 1, prescriptionId: "sq" })];
        setup({ active: session({ programDayId: "d1" }) });
        expect(await screen.findByRole("img", { name: "Set 1: your coach asked for a video, not filmed yet" })).toBeInTheDocument();
        await settle();
        expect(popup()).not.toBeInTheDocument();
      });

      it("opens the picker for the logged set from Attach now", async () => {
        const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
        try {
          const { user } = setup({ active: session({ programDayId: "d1" }) });
          await screen.findByRole("group", { name: "Set 1" });
          await dropWarmups(user);
          await user.click(screen.getByRole("button", { name: "Log Set 1" }));
          await user.click(await screen.findByRole("button", { name: "Attach now" }));
          expect(click).toHaveBeenCalledTimes(1);
          const input = click.mock.contexts[0] as HTMLInputElement;
          expect(input.type).toBe("file");
          expect(squatBlock().contains(input)).toBe(true);
          expect(popup()).not.toBeInTheDocument();
        } finally {
          click.mockRestore();
        }
      });

      it("never asks for a warm-up, even on a row the coach flagged", async () => {
        const { user } = setup({ active: session({ programDayId: "d1" }) });
        await screen.findByRole("group", { name: "Set 1" });
        await dropWarmups(user);
        await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
        await user.click(screen.getByRole("switch", { name: "Warm-up" }));
        await user.click(screen.getByRole("button", { name: "Log Warm-up set" }));
        await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
        await settle();
        expect(popup()).not.toBeInTheDocument();
      });

      it("never asks when the exercise already has a clip", async () => {
        storedSets.value = [logged("a", 150, 1, { setIndex: 1, prescriptionId: "sq", hasVideo: true })];
        const { user } = setup({ active: session({ programDayId: "d1" }) });
        await openNext(user);
        await user.click(screen.getByRole("button", { name: "Log Set 2" }));
        await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
        await settle();
        expect(popup()).not.toBeInTheDocument();
      });

      it("never asks for a set the phone could not write down", async () => {
        logSet.mockRejectedValueOnce(new Error("quota"));
        const { user } = setup({ active: session({ programDayId: "d1" }) });
        await screen.findByRole("group", { name: "Set 1" });
        await dropWarmups(user);
        await user.click(screen.getByRole("button", { name: "Log Set 1" }));
        await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
        await settle();
        expect(popup()).not.toBeInTheDocument();
      });

      it("never asks for an exercise the coach did not flag", async () => {
        const { user } = setup({ active: session({ programDayId: "d1" }) });
        await screen.findByRole("group", { name: "Set 1" });
        await user.click(within(screen.getByRole("region", { name: "Barbell Row" })).getByRole("button", { name: "Barbell Row" }));
        await user.click(within(screen.getByRole("region", { name: "Barbell Row" })).getByRole("button", { name: "Log Set 1" }));
        await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
        await settle();
        expect(popup()).not.toBeInTheDocument();
      });
    });

    it("reads a clip already on a logged set as answered after a reload", async () => {
      storedSets.value = [
        logged("a", 150, 10, { setIndex: 1, prescriptionId: "sq", hasVideo: true }),
        logged("b", 150, 5, { setIndex: 2, prescriptionId: "sq" }),
      ];
      setup({ active: session({ programDayId: "d1" }) });
      expect(await screen.findByRole("img", { name: "Set 1: video attached" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Set 2: your coach asked for a video, not filmed yet" })).toBeInTheDocument();
      expect(screen.queryByText("Your coach asked for a clip of this one.")).not.toBeInTheDocument();
    });
  });

  describe("swapping the variant", () => {
    const rowBlock = (name = "Barbell Row") => screen.getByRole("region", { name });
    const openRows = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByRole("group", { name: "Set 1" });
      await user.click(within(rowBlock()).getByRole("button", { name: "Barbell Row" }));
    };
    const swapTo = async (user: ReturnType<typeof userEvent.setup>, from: string, to: string) => {
      await user.click(screen.getByRole("button", { name: `Swap variant of ${from}` }));
      const sheet = screen.getByRole("region", { name: `Swap variant of ${from}` });
      await user.click(within(sheet).getByRole("button", { name: new RegExp(`^${to}`) }));
    };

    it("is offered only where the library holds a sibling", async () => {
      setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      expect(screen.getByRole("button", { name: "Swap variant of Barbell Row" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Swap variant of Squat" })).not.toBeInTheDocument();
    });

    it("opens in the bottom sheet with the coach's pick first and labelled", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await user.click(screen.getByRole("button", { name: "Swap variant of Barbell Row" }));
      const sheet = document.querySelector("[data-log-sheet]")!;
      const picker = within(sheet as HTMLElement).getByRole("region", { name: "Swap variant of Barbell Row" });
      const [coach, other] = within(picker).getAllByRole("button");
      expect(coach).toHaveTextContent("Barbell RowCoach’s pick");
      expect(coach).toHaveAttribute("aria-pressed", "true");
      expect(other).toHaveTextContent("Dumbbell Row");
      await user.click(within(picker).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("region", { name: "Swap variant of Barbell Row" })).not.toBeInTheDocument();
    });

    it("moves the unlogged rows to the variant, drops the barbell load and keeps the line", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await openRows(user);
      await swapTo(user, "Barbell Row", "Dumbbell Row");

      const block = rowBlock("Dumbbell Row");
      expect(block).toHaveTextContent("Coach’s pick: Barbell Row");
      expect(screen.queryByRole("region", { name: "Barbell Row" })).not.toBeInTheDocument();
      expect(rowsIn(block)).toEqual(["Set 1", "Set 2", "Set 3"]);
      const first = within(block).getByRole("group", { name: "Set 1" });
      expect(within(first).getByRole("button", { name: "Set 1 weight in kilograms" })).toHaveTextContent("KG");
      expect(within(first).getByRole("button", { name: "Set 1 reps" })).toHaveTextContent("8");
      // The coach's line is unchanged above the rows.
      expect(within(block).getByRole("list", { name: "Dumbbell Row prescribed" })).toHaveTextContent("3 × 8 · 60 kg");

      await user.click(within(first).getByRole("button", { name: "Set 1 weight in kilograms" }));
      for (const key of ["2", "5"]) await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Done" }));
      await user.click(within(block).getByRole("button", { name: "Log Set 1" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
      expect(logSet.mock.calls[0][0]).toMatchObject({
        exerciseId: "db-row",
        loadKg: 25,
        reps: 8,
        setIndex: 1,
        prescriptionId: "row",
        prescribed: "8 reps · 60 kg · prescribed Barbell Row",
      });
      // Counted against the line: the next row repeats the dumbbell set, and is set 2 of 3.
      expect(within(block).getByRole("list", { name: "Dumbbell Row prescribed" })).toHaveTextContent("Next: Set 2 of 3");
      expect(within(block).getByRole("group", { name: "Set 2" })).toHaveTextContent("25");
    });

    it("never rewrites a set already logged, and swapping back restores the coach's load", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await openRows(user);
      await user.click(within(rowBlock()).getByRole("button", { name: "Log Set 1" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
      expect(logSet.mock.calls[0][0]).toMatchObject({ exerciseId: "bb-row", loadKg: 60 });

      await swapTo(user, "Barbell Row", "Dumbbell Row");
      const block = rowBlock("Dumbbell Row");
      // The logged barbell set stays in the block, as logged; two dumbbell rows follow it.
      expect(rowsIn(block)).toEqual(["Set 1", "Set 2", "Set 3"]);
      expect(within(block).getByRole("group", { name: "Set 1" })).toHaveTextContent("60");
      expect(within(block).getByLabelText("Logged")).toBeInTheDocument();
      expect(within(block).getByRole("button", { name: "Set 2 weight in kilograms" })).toHaveTextContent("KG");

      await swapTo(user, "Dumbbell Row", "Barbell Row");
      expect(within(rowBlock()).getByRole("button", { name: "Set 2 weight in kilograms" })).toHaveTextContent("60");
      expect(rowBlock()).not.toHaveTextContent("Coach’s pick");
    });

    it("swaps a block before anything is laid out, and lays the rest out on the variant", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await swapTo(user, "Barbell Row", "Dumbbell Row");
      expect(rowsIn(rowBlock("Dumbbell Row"))).toEqual(["Set 1", "Set 2", "Set 3"]);
    });

    it("keeps the swap after a reload, from the set's own prescription link", async () => {
      storedSets.value = [
        { ...logged("d1", 25, 5, { setIndex: 1, prescriptionId: "row" }), exerciseId: "db-row", reps: 8 },
      ];
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      const block = await screen.findByRole("region", { name: "Dumbbell Row" });
      expect(block).toHaveTextContent("Coach’s pick: Barbell Row");
      expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Squat", "Dumbbell Row"]);
      expect(within(block).getByRole("list", { name: "Dumbbell Row prescribed" })).toHaveTextContent("Next: Set 2 of 3");
      await user.click(within(block).getByRole("button", { name: "Dumbbell Row" }));
      expect(rowsIn(block)).toEqual(["Set 1", "Set 2", "Set 3"]);
      expect(within(block).getByRole("group", { name: "Set 2" })).toHaveTextContent("25");
    });

    it("works on a free block too", async () => {
      prescribed.value = null;
      const { user } = setup({ active: session() });
      await user.type(screen.getByRole("combobox"), "cable front");
      await user.click(screen.getByRole("option", { name: "Cable Front Raise" }));
      await swapTo(user, "Cable Front Raise", "Plate Front Raise");
      const block = screen.getByRole("region", { name: "Plate Front Raise" });
      expect(block).not.toHaveTextContent("Coach’s pick");
      await user.click(within(block).getByRole("button", { name: "Set 1 weight in kilograms" }));
      for (const key of ["1", "0"]) await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Reps" }));
      for (const key of ["1", "2"]) await user.click(screen.getByRole("button", { name: key }));
      await user.click(within(block).getByRole("button", { name: "Log Set 1" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
      expect(logSet.mock.calls[0][0]).toMatchObject({ exerciseId: "p-raise", loadKg: 10, reps: 12 });
      expect(logSet.mock.calls[0][0]).not.toHaveProperty("prescriptionId");
    });

    it("does not offer a variant that already has its own block", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await user.type(screen.getByRole("combobox"), "dumbbell row");
      await user.click(screen.getByRole("option", { name: "Dumbbell Row" }));
      expect(screen.getByRole("region", { name: "Dumbbell Row" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Swap variant of Barbell Row" })).not.toBeInTheDocument();
    });

    it("removes the whole block, every variant's sets with it", async () => {
      storedSets.value = [
        { ...logged("b1", 60, 10, { setIndex: 1, prescriptionId: "row" }), exerciseId: "bb-row", reps: 8 },
        { ...logged("d1", 25, 5, { setIndex: 1, prescriptionId: "row" }), exerciseId: "db-row", reps: 8 },
      ];
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      const block = await screen.findByRole("region", { name: "Dumbbell Row" });
      await waitFor(() => expect(rowsIn(block)).toEqual(["Set 1", "Set 2"]));
      await user.click(within(block).getByRole("button", { name: "Remove Dumbbell Row from this session" }));
      expect(within(block).getByRole("group", { name: "Remove Dumbbell Row?" })).toHaveTextContent("Its 2 logged sets");
      await user.click(within(block).getByRole("button", { name: "Remove exercise" }));
      expect(screen.queryByRole("region", { name: "Dumbbell Row" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Barbell Row" })).not.toBeInTheDocument();
    });
  });

  describe("the rest bar in the sheet", () => {
    const sheet = () => document.querySelector("[data-log-sheet]");

    it("comes up in the pinned sheet after a set is logged, wherever the row was", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await dropWarmups(user);
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      const timer = await screen.findByRole("timer", { name: "Rest timer" });
      expect(sheet()).toContainElement(timer);
      expect(sheet()!.className).toContain("sticky");
      // One timer, never a second copy in the footer.
      expect(screen.getAllByRole("timer")).toHaveLength(1);
    });

    it("steps aside for the variant picker and comes back after", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await dropWarmups(user);
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await screen.findByRole("timer");
      await user.click(screen.getByRole("button", { name: "Swap variant of Barbell Row" }));
      expect(screen.queryByRole("timer")).not.toBeInTheDocument();
      expect(sheet()).toContainElement(screen.getByRole("region", { name: "Swap variant of Barbell Row" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(sheet()).toContainElement(screen.getByRole("timer"));
    });

    it("gives way to the finish confirm, which stays in the footer", async () => {
      const { user } = setup({ active: session({ programDayId: "d1" }) });
      await screen.findByRole("group", { name: "Set 1" });
      await dropWarmups(user);
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await screen.findByRole("timer");
      await user.click(screen.getByRole("button", { name: "End session" }));
      expect(screen.queryByRole("timer")).not.toBeInTheDocument();
      expect(sheet()).toBeNull();
      expect(screen.getByRole("button", { name: "Keep going" })).toBeInTheDocument();
    });

    it("comes back in the sheet after a reload while the rest is running", async () => {
      rememberRest({ startedAt: new Date(Date.now() - 30_000), restMs: 120_000 });
      setup({ active: session() });
      const timer = await screen.findByRole("timer", { name: "Rest timer" });
      expect(sheet()).toContainElement(timer);
    });
  });
});

describe("last time and records (F6)", () => {
  const prev = (loadKg: number, reps: number, isWarmup = false) => ({ loadKg, reps, isWarmup });
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const squatBlock = () => screen.getByRole("region", { name: "Squat" });
  /** The Previous line under a row: the row group's wrapper holds it. */
  const previousOf = (row: HTMLElement) => row.closest("[data-arrived], div.flex-col")?.querySelector("[data-previous]") ?? null;
  const withVibrate = () => {
    const vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
    return vibrate;
  };
  // No queue attached: known empty from the start, whatever ran before.
  beforeEach(() => resetQueueForTests());
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).vibrate;
  });

  describe("the Previous line", () => {
    it("lines last time up with today, warm-ups with warm-ups and working sets with working sets", async () => {
      exerciseHistory.value.squat = {
        previous: [prev(50, 5, true), prev(80, 3, true), prev(140, 5), prev(145, 3)],
        bests: null,
      };
      storedSets.value = [
        logged("w", 60, 10, { isWarmup: true }),
        logged("a", 142.5, 5),
      ];
      setup({ active: session() });
      const warmup = await screen.findByRole("group", { name: "Warm-up set" });
      await waitFor(() => expect(previousOf(warmup)).toHaveTextContent("PREV 50 × 5"));
      expect(previousOf(screen.getByRole("group", { name: "Set 1" }))).toHaveTextContent("PREV 140 × 5");
    });

    it("shows nothing, and no error, when last time cannot be read", async () => {
      exerciseHistory.fail = true;
      storedSets.value = [logged("a", 142.5, 5)];
      setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      expect(document.querySelector("[data-previous]")).toBeNull();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/couldn.t|failed/i)).not.toBeInTheDocument();
    });

    it("tries again when the signal comes back", async () => {
      exerciseHistory.fail = true;
      exerciseHistory.value.squat = { previous: [prev(140, 5)], bests: null };
      storedSets.value = [logged("a", 142.5, 5)];
      setup({ active: session() });
      await waitFor(() => expect(exerciseHistory.calls).toHaveLength(1));
      exerciseHistory.fail = false;
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() => expect(previousOf(screen.getByRole("group", { name: "Set 1" }))).toHaveTextContent("140 × 5"));
    });

    it("shows nothing for an exercise never trained before", async () => {
      storedSets.value = [logged("a", 142.5, 5)];
      setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      expect(document.querySelector("[data-previous]")).toBeNull();
    });

    it("reads each exercise once for the session, however often the screen renders or reopens", async () => {
      exerciseHistory.value.squat = { previous: [prev(140, 5)], bests: null };
      const { user, unmount } = setup({ active: session() });
      await addSquat(user);
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      await waitFor(() => expect(document.querySelector("[data-previous]")).not.toBeNull());
      // Off to Lift Detail and back: the read is the module's, not the screen's.
      unmount();
      setup({ active: session() });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(exerciseHistory.calls).toEqual(["squat"]);
    });

    it("does not hold the Log up while it reads", async () => {
      let release!: () => void;
      exerciseHistory.hold = new Promise<void>((resolve) => (release = resolve));
      exerciseHistory.value.squat = { previous: [prev(140, 5)], bests: null };
      const { user } = setup({ active: session() });
      await addSquat(user);
      expect(screen.getByRole("button", { name: "Log Set 1" })).toBeInTheDocument();
      expect(document.querySelector("[data-previous]")).toBeNull();
      await act(async () => release());
      await waitFor(() => expect(document.querySelector("[data-previous]")).toHaveTextContent("140 × 5"));
    });

    it("reads in the athlete's unit", async () => {
      profile.units = "lb";
      exerciseHistory.value.squat = { previous: [prev(142.882, 5)], bests: null };
      storedSets.value = [logged("a", 142.882, 5)];
      setup({ active: session(), withUnits: true });
      const row = await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(previousOf(row)).toHaveTextContent("PREV 315 × 5"));
    });
  });

  describe("copying last time into a row", () => {
    it("copies load and reps into a row not logged yet, as the athlete's own", async () => {
      exerciseHistory.value.squat = { previous: [prev(140, 5), prev(150, 3)], bests: null };
      storedSets.value = [logged("a", 140, 5)];
      const { user } = setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      const copy = await screen.findByRole("button", { name: "Set 2: use last time, 150 kilograms for 3 reps" });
      await user.click(copy);
      const row = screen.getByRole("group", { name: "Set 2" });
      expect(within(row).getByRole("button", { name: "Set 2 weight in kilograms" })).toHaveTextContent("150");
      expect(within(row).getByRole("button", { name: "Set 2 reps" })).toHaveTextContent("3");
      await user.click(screen.getByRole("button", { name: "Log Set 2" }));
      await waitFor(() => expect(logSet).toHaveBeenCalledWith(expect.objectContaining({ loadKg: 150, reps: 3 })));
    });

    it("is not a button on a logged set", async () => {
      exerciseHistory.value.squat = { previous: [prev(140, 5)], bests: null };
      storedSets.value = [logged("a", 142.5, 5)];
      setup({ active: session() });
      const row = await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(previousOf(row)).not.toBeNull());
      expect(screen.queryByRole("button", { name: /use last time/ })).not.toBeInTheDocument();
    });

    it("restarts an open pad from the copied number", async () => {
      exerciseHistory.value.squat = { previous: [prev(140, 5), prev(150, 3)], bests: null };
      storedSets.value = [logged("a", 140, 5)];
      const { user } = setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
      await user.click(await screen.findByRole("button", { name: /Set 2: use last time/ }));
      // The stepper now moves on from 150, not from the 140 the pad opened on.
      await user.click(screen.getByRole("button", { name: /^Increase/ }));
      expect(screen.getByRole("button", { name: "Set 2 weight in kilograms" })).toHaveTextContent("152.5");
    });
  });

  describe("prefill rule 4: same exercise last session", () => {
    it("starts a free exercise's first row at last time's first working set", async () => {
      exerciseHistory.value.squat = { previous: [prev(60, 5, true), prev(140, 5), prev(145, 3)], bests: null };
      const { user } = setup({ active: session() });
      await addSquat(user);
      const row = screen.getByRole("group", { name: "Set 1" });
      await waitFor(() =>
        expect(within(row).getByRole("button", { name: "Set 1 weight in kilograms" })).toHaveTextContent("140"),
      );
      expect(within(row).getByRole("button", { name: "Set 1 reps" })).toHaveTextContent("5");
      expect(screen.getByRole("button", { name: "Log Set 1" })).toBeEnabled();
    });

    it("fills a blank row when last time arrives after it, and never one the athlete typed in", async () => {
      let release!: () => void;
      exerciseHistory.hold = new Promise<void>((resolve) => (release = resolve));
      exerciseHistory.value.squat = { previous: [prev(140, 5), prev(145, 3)], bests: null };
      const { user } = setup({ active: session() });
      await addSquat(user);
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      // Set 2 typed by hand before the read lands.
      await user.click(screen.getByRole("button", { name: "Set 2 reps" }));
      await user.click(screen.getByRole("button", { name: "8" }));
      await act(async () => release());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Set 1 weight in kilograms" })).toHaveTextContent("140"),
      );
      expect(screen.getByRole("button", { name: "Set 2 weight in kilograms" })).toHaveTextContent("KG");
      expect(screen.getByRole("button", { name: "Set 2 reps" })).toHaveTextContent("8");
    });

    it("leaves a prescribed exercise to the coach: warm-ups stay blank, working sets stay priced", async () => {
      library.exercises = [squat];
      prescribed.value = {
        status: "ready",
        day: {
          program: { id: "p1" },
          week: { id: "w1" },
          day: { id: "d1", label: "Day 1", notes: null },
          prescriptions: [
            {
              id: "sq", exerciseId: "squat", position: 0, setCount: 1, reps: 5, load: "75%", warmupSets: 1,
              programId: "p1", weekId: "w1", dayId: "d1", repMax: null, restSeconds: null, notes: null, loadKind: null,
              updatedAt: "2026-10-01T00:00:00Z",
            },
          ],
        },
        maxes: {
          entries: [
            { id: "m1", exerciseId: "squat", kind: "training", valueKg: 200, effectiveFrom: "2026-01-01T00:00:00Z", recordedBy: "coach" },
          ],
          estimated: new Map(),
        },
      };
      exerciseHistory.value.squat = { previous: [prev(60, 5, true), prev(140, 5)], bests: null };
      setup({ active: session({ programDayId: "d1" }) });
      const warmup = await screen.findByRole("group", { name: "Warm-up set" });
      await waitFor(() => expect(previousOf(warmup)).toHaveTextContent("PREV 60 × 5"));
      expect(within(warmup).getByRole("button", { name: "Warm-up set weight in kilograms" })).toHaveTextContent("KG");
      expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("150");
    });
  });

  describe("the exercise's history", () => {
    it("links the block to Lift Detail for the exercise", async () => {
      storedSets.value = [logged("a", 142.5, 5)];
      setup({ active: session() });
      await screen.findByRole("region", { name: "Squat" });
      expect(within(squatBlock()).getByRole("link", { name: "Squat history and records" })).toHaveAttribute("href", "/lift/squat");
    });
  });

  describe("PR badges", () => {
    const bests = { e1rmKg: 170, heaviestKg: 150 };

    it("badges a heavier set than ever, pops it in and buzzes once", async () => {
      const vibrate = withVibrate();
      exerciseHistory.value.squat = { previous: [], bests };
      storedSets.value = [logged("a", 140, 5)];
      const { user } = setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
      await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
      for (const key of ["1", "5", "5"]) await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Reps" }));
      await user.click(screen.getByRole("button", { name: "1" }));
      await user.click(screen.getByRole("button", { name: "Log Set 2" }));
      const badge = await screen.findByRole("img", { name: "Set 2: personal record, heaviest weight" });
      expect(badge.className).toContain("motion-safe:animate-spring-pop");
      expect(vibrate).toHaveBeenCalledWith([...HAPTICS.success]);
      const buzzes = vibrate.mock.calls.filter((call) => JSON.stringify(call[0]) === JSON.stringify(HAPTICS.success));
      expect(buzzes).toHaveLength(1);
      // Set 1 broke nothing.
      expect(screen.queryByRole("img", { name: /Set 1: personal record/ })).not.toBeInTheDocument();
    });

    it("reads the same badge back after a reload, without popping or buzzing again", async () => {
      const vibrate = withVibrate();
      exerciseHistory.value.squat = { previous: [], bests };
      storedSets.value = [logged("a", 155, 5)];
      setup({ active: session() });
      const badge = await screen.findByRole("img", { name: "Set 1: personal record, heaviest weight" });
      expect(badge.className).not.toContain("animate-spring-pop");
      expect(vibrate).not.toHaveBeenCalled();
      expect(screen.getAllByRole("img", { name: /personal record/ })).toHaveLength(1);
    });

    it("keeps last time and the badges through a reload with no signal", async () => {
      exerciseHistory.value.squat = { previous: [prev(140, 5)], bests };
      storedSets.value = [logged("a", 155, 5)];
      const { unmount } = setup({ active: session() });
      await screen.findByRole("img", { name: "Set 1: personal record, heaviest weight" });
      // A reload: the module's memory goes, the device's copy stays.
      const kept = localStorage.getItem("snb.exercise-history");
      expect(kept).not.toBeNull();
      unmount();
      forgetExerciseHistory();
      localStorage.setItem("snb.exercise-history", kept!);
      exerciseHistory.fail = true;
      setup({ active: session() });
      expect(await screen.findByRole("img", { name: "Set 1: personal record, heaviest weight" })).toBeInTheDocument();
      expect(previousOf(screen.getByRole("group", { name: "Set 1" }))).toHaveTextContent("PREV 140 × 5");
      expect(exerciseHistory.calls).toEqual(["squat"]);
    });

    it("never badges a warm-up, however heavy", async () => {
      exerciseHistory.value.squat = { previous: [], bests };
      storedSets.value = [logged("w", 200, 5, { isWarmup: true })];
      setup({ active: session() });
      await screen.findByRole("group", { name: "Warm-up set" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      expect(screen.queryByRole("img", { name: /personal record/ })).not.toBeInTheDocument();
    });

    it("badges nothing on the first session of a lift, or with no signal", async () => {
      exerciseHistory.fail = true;
      storedSets.value = [logged("a", 155, 5)];
      setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      expect(screen.queryByRole("img", { name: /personal record/ })).not.toBeInTheDocument();
    });

    it("badges an e1RM record from the RPE, and both kinds on one set", async () => {
      exerciseHistory.value.squat = { previous: [], bests };
      // 160 x 3 @ 9: Brzycki on 4 to failure, 160 * 36 / 33 = 174.5 > 170.
      storedSets.value = [logged("a", 160, 5, { reps: 3, rpe: 9 })];
      setup({ active: session() });
      expect(
        await screen.findByRole("img", { name: "Set 1: personal record, estimated one-rep max and heaviest weight" }),
      ).toBeInTheDocument();
    });

    it("lists the day's records on the finish screen", async () => {
      exerciseHistory.value.squat = { previous: [], bests };
      storedSets.value = [logged("a", 152.5, 10, { reps: 2 }), logged("b", 155, 5, { reps: 1 })];
      const finish = vi.fn(async () => {
        training.value = { ...training.value, active: null };
      });
      const { user } = setup({ active: session(), finish });
      await screen.findAllByRole("img", { name: /personal record/ });
      await user.click(screen.getByRole("button", { name: "Finish session" }));
      await user.click(screen.getByRole("button", { name: "Finish" }));
      const records = await screen.findByRole("region", { name: "Personal records" });
      // Two heavier sets, one line: the one that stood at the end.
      const items = within(records).getAllByRole("listitem");
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent("Squat");
      expect(items[0]).toHaveTextContent("Heaviest weight · 155 kg × 1");
    });

    describe("rep records", () => {
      // Most at 140 or more: 5, from 142.5 x 5. Ten at 100.
      const withReps = {
        ...bests,
        repsAt: [
          { loadKg: 150, reps: 2 },
          { loadKg: 142.5, reps: 5 },
          { loadKg: 100, reps: 10 },
        ],
      };

      it("badges more reps than ever at a load, pops it in and buzzes once", async () => {
        const vibrate = withVibrate();
        exerciseHistory.value.squat = { previous: [], bests: withReps };
        storedSets.value = [logged("a", 140, 5)];
        const { user } = setup({ active: session() });
        await screen.findByRole("group", { name: "Set 1" });
        await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
        await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
        await user.click(screen.getByRole("button", { name: "Set 2 weight in kilograms" }));
        for (const key of ["1", "4", "0"]) await user.click(screen.getByRole("button", { name: key }));
        await user.click(screen.getByRole("button", { name: "Reps" }));
        await user.click(screen.getByRole("button", { name: "6" }));
        await user.click(screen.getByRole("button", { name: "Log Set 2" }));
        const badge = await screen.findByRole("img", { name: "Set 2: personal record, most reps at this weight" });
        expect(badge).toHaveTextContent("Rep PR");
        expect(badge.className).toContain("motion-safe:animate-spring-pop");
        const buzzes = vibrate.mock.calls.filter((call) => JSON.stringify(call[0]) === JSON.stringify(HAPTICS.success));
        expect(buzzes).toHaveLength(1);
        // 140 x 5 ties the 142.5 x 5 already done: no record.
        expect(screen.queryByRole("img", { name: /Set 1: personal record/ })).not.toBeInTheDocument();
      });

      it("badges no rep record when the whole history could not be read", async () => {
        exerciseHistory.value.squat = { previous: [], bests: { ...withReps, repsAt: null } };
        storedSets.value = [logged("a", 140, 5, { reps: 9 })];
        setup({ active: session() });
        await screen.findByRole("group", { name: "Set 1" });
        await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
        expect(screen.queryByRole("img", { name: /personal record/ })).not.toBeInTheDocument();
      });

      it("lists one rep record per load on the finish screen", async () => {
        exerciseHistory.value.squat = { previous: [], bests: withReps };
        storedSets.value = [
          logged("a", 140, 10, { reps: 6 }),
          logged("b", 140, 8, { reps: 7 }),
          logged("c", 100, 5, { reps: 12 }),
        ];
        const finish = vi.fn(async () => {
          training.value = { ...training.value, active: null };
        });
        const { user } = setup({ active: session(), finish });
        await screen.findAllByRole("img", { name: /personal record/ });
        await user.click(screen.getByRole("button", { name: "Finish session" }));
        await user.click(screen.getByRole("button", { name: "Finish" }));
        const records = await screen.findByRole("region", { name: "Personal records" });
        const items = within(records).getAllByRole("listitem");
        // 140 x 6 then 140 x 7: one line, the seven.
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent("Rep PR · 140 kg × 7");
        expect(items[0]).toHaveTextContent("7 reps");
        expect(items[1]).toHaveTextContent("Rep PR · 100 kg × 12");
      });
    });

    it("shows no records section when nothing was broken", async () => {
      exerciseHistory.value.squat = { previous: [], bests };
      storedSets.value = [logged("a", 140, 5)];
      const finish = vi.fn(async () => {
        training.value = { ...training.value, active: null };
      });
      const { user } = setup({ active: session(), finish });
      await screen.findByRole("group", { name: "Set 1" });
      await user.click(screen.getByRole("button", { name: "Finish session" }));
      await user.click(screen.getByRole("button", { name: "Finish" }));
      await screen.findByText("Session done");
      expect(screen.queryByRole("region", { name: "Personal records" })).not.toBeInTheDocument();
    });
  });

  describe("a swapped variant", () => {
    const barbellRow: Exercise = { id: "bb-row", name: "Barbell Row", normalisedName: "barbell row", isGlobal: true };
    const dumbbellRow: Exercise = { id: "db-row", name: "Dumbbell Row", normalisedName: "dumbbell row", isGlobal: true };

    beforeEach(() => {
      library.exercises = [squat, barbellRow, dumbbellRow];
      prescribed.value = {
        status: "ready",
        day: {
          program: { id: "p1" },
          week: { id: "w1" },
          day: { id: "d1", label: "Day 1", notes: null },
          prescriptions: [
            {
              id: "row", exerciseId: "bb-row", position: 0, setCount: 2, reps: 8, load: "60",
              programId: "p1", weekId: "w1", dayId: "d1", repMax: null, restSeconds: null, notes: null, loadKind: null,
              updatedAt: "2026-10-01T00:00:00Z",
            },
          ],
        },
        maxes: { entries: [], estimated: new Map() },
      };
      exerciseHistory.value["bb-row"] = { previous: [prev(70, 8), prev(70, 8)], bests: { e1rmKg: null, heaviestKg: 80 } };
      exerciseHistory.value["db-row"] = { previous: [prev(30, 10), prev(32.5, 8)], bests: { e1rmKg: null, heaviestKg: 30 } };
    });

    it("reads the variant's own last time, its own records and its own history", async () => {
      // One Barbell Row set before the swap, one Dumbbell Row set after it.
      storedSets.value = [
        { ...logged("r1", 60, 10, { reps: 8, prescriptionId: "row" }), exerciseId: "bb-row" },
        { ...logged("d1", 32.5, 5, { reps: 8, prescriptionId: "row" }), exerciseId: "db-row" },
      ];
      setup({ active: session({ programDayId: "d1" }) });
      const block = await screen.findByRole("region", { name: "Dumbbell Row" });
      await waitFor(() => expect(within(block).getByRole("group", { name: "Set 2" }).closest("div.flex-col")?.querySelector("[data-previous]")).toHaveTextContent("30 × 10"));
      // Set 1 was a barbell set: its last time is the barbell's.
      expect(previousOf(within(block).getByRole("group", { name: "Set 1" }))).toHaveTextContent("70 × 8");
      // 32.5 beats the dumbbell's 30, though nowhere near the barbell's 80.
      expect(within(block).getByRole("img", { name: "Set 2: personal record, heaviest weight" })).toBeInTheDocument();
      expect(within(block).getByRole("link", { name: "Dumbbell Row history and records" })).toHaveAttribute("href", "/lift/db-row");
    });
  });
});

/* ------------------------------------------------------------------------ */

describe("correcting a logged set (F9)", () => {
  const prev = (loadKg: number, reps: number, isWarmup = false) => ({ loadKg, reps, isWarmup });
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const sheet = () => screen.getByRole("region", { name: /^Edit / });
  /** Types into the open keypad: the first key replaces the number, as when logging. */
  const type = async (user: ReturnType<typeof userEvent.setup>, digits: string) => {
    for (const key of [...digits]) {
      await user.click(within(sheet()).getByRole("button", { name: key === "." ? "Decimal point" : key }));
    }
  };
  const twoSets = () => {
    storedSets.value = [
      logged("a", 140, 20, { setIndex: 1, rpe: 7 }),
      logged("b", 150, 10, { setIndex: 2, rpe: 8 }),
    ];
  };
  beforeEach(() => resetQueueForTests());

  it("opens the tapped set in a sheet titled for it, prefilled, with Save rather than a confirm", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 2" }));

    expect(within(sheet()).getByRole("heading", { name: "Edit set 2" })).toBeInTheDocument();
    expect(sheet()).toHaveTextContent("Squat · logged");
    const values = within(sheet()).getByRole("group", { name: "Values being saved" });
    expect(within(values).getByRole("button", { name: "Change weight, now 150 kilograms" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(values).getByRole("button", { name: "Change reps, now 5" })).toBeInTheDocument();
    expect(within(values).getByRole("button", { name: "Change RPE, now 8" })).toBeInTheDocument();
    // The keypad starts on the weight.
    expect(within(sheet()).getByRole("region", { name: "Weight, kg keypad" })).toHaveTextContent("150");
    expect(within(sheet()).getByRole("button", { name: "Save Set 2" })).toBeEnabled();
    // Nothing here logs a set: no confirm square, no Done.
    expect(screen.queryByRole("button", { name: /^Log Set/ })).not.toBeInTheDocument();
    expect(within(sheet()).queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    // The row being corrected is outlined, and still shows what was logged.
    expect(screen.getByRole("group", { name: "Set 2" }).className).toContain("outline-accent-line");
  });

  it("saves new weight, reps and RPE through editSet, and the row, totals and finish follow", async () => {
    twoSets();
    const { user, finish } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 2" }));

    await type(user, "152.5");
    await user.click(within(sheet()).getByRole("button", { name: "Reps" }));
    await type(user, "3");
    await user.click(within(sheet()).getByRole("button", { name: "RPE" }));
    await user.click(within(sheet()).getByRole("button", { name: "9" }));
    // The row is untouched until Save.
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    await user.click(screen.getByRole("button", { name: "Save Set 2" }));

    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
    expect(editSet).toHaveBeenCalledTimes(1);
    expect(editSet.mock.calls[0][0]).toBe("b");
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 152.5, reps: 3, rpe: 9, isWarmup: false, failed: false, notes: null });
    expect(editSet.mock.calls[0][2]).toMatchObject({ exerciseId: "squat" });
    const row = screen.getByRole("group", { name: "Set 2" });
    expect(row).toHaveTextContent("152.5");
    expect(screen.getByLabelText("Set 2 reps")).toHaveTextContent("3");
    expect(screen.getByLabelText("Set 2 RPE")).toHaveTextContent("9");
    expect(logSet).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Finish session" }));
    await user.click(screen.getByRole("button", { name: "Finish" }));
    // 140 x 5 + 152.5 x 3.
    expect(finish).toHaveBeenCalledWith("s1", { setCount: 2, tonnageKg: 1157.5 });
  });

  it("leaves the set exactly as logged on Cancel, or on a confirmed tap on the dimmed page", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await type(user, "99");
    // Cancel is explicit, so it does not ask.
    await user.click(screen.getByRole("button", { name: "Cancel, keep Set 1 as logged" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");

    await user.click(screen.getByRole("group", { name: "Set 1" }));
    // Opens on the logged numbers again, not the abandoned draft.
    expect(within(sheet()).getByRole("region", { name: "Weight, kg keypad" })).toHaveTextContent("140");
    await type(user, "99");
    // The rows are behind the scrim now (F16); the scrim is the way out.
    await user.click(document.querySelector("[data-scrim]")!);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("140");
    expect(editSet).not.toHaveBeenCalled();
  });

  it("closes on Save with nothing changed and writes nothing", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await user.click(screen.getByRole("button", { name: "Save Set 1" }));
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
    expect(editSet).not.toHaveBeenCalled();
  });

  it("will not save a set with no weight", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    for (let i = 0; i < 3; i++) await user.click(within(sheet()).getByRole("button", { name: "Backspace" }));
    expect(screen.getByRole("button", { name: "Save Set 1" })).toBeDisabled();
  });

  it("makes a set a warm-up from the sheet's switch, without its RPE, and renumbers the rest", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await user.click(within(sheet()).getByRole("switch", { name: "Warm-up" }));
    expect(within(sheet()).getByRole("button", { name: "Change RPE, now none, warm-up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save Set 1" }));

    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 140, reps: 5, rpe: null, isWarmup: true, failed: false, notes: null });
    expect(screen.getByRole("group", { name: "Warm-up set" })).toHaveTextContent("140");
    expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("150");
    expect(screen.queryByRole("group", { name: "Set 2" })).not.toBeInTheDocument();

    // Opened again and made working, it offers the RPE it had.
    await user.click(screen.getByRole("group", { name: "Warm-up set" }));
    expect(within(sheet()).getByRole("heading", { name: "Edit warm-up" })).toBeInTheDocument();
    await user.click(within(sheet()).getByRole("switch", { name: "Warm-up" }));
    expect(within(sheet()).getByRole("button", { name: "Change RPE, now 7" })).toBeEnabled();
  });

  it("does not open a set still on its way to the phone's storage", async () => {
    let release: () => void = () => {};
    logSet.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of "140") await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));

    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();

    await act(async () => release());
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    expect(within(sheet()).getByRole("heading", { name: "Edit set 1" })).toBeInTheDocument();
  });

  it("puts the set back and says so when the phone could not store the edit", async () => {
    twoSets();
    editSet.mockRejectedValueOnce(new DOMException("Quota exceeded", "QuotaExceededError"));
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 2" }));
    await type(user, "160");
    await user.click(screen.getByRole("button", { name: "Save Set 2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That change wasn’t saved");
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
  });

  it("keeps Delete in the sheet, and the swipe and the set number still work beside it", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await user.click(within(sheet()).getByRole("button", { name: "Delete Set 1" }));
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
    expect(await screen.findByText("Squat set 1 deleted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    // The set number flips without opening the sheet.
    await user.click(screen.getByRole("button", { name: "Set 2: mark as warm-up" }));
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 150, reps: 5, rpe: null, isWarmup: true, failed: false });

    const row = screen.getByRole("group", { name: "Set 1" });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 250, clientY: 12 });
    fireEvent.pointerMove(row, { clientX: 150, clientY: 12 });
    fireEvent.pointerUp(row, { clientX: 150, clientY: 12 });
    expect(await screen.findByText("Squat set 1 deleted")).toBeInTheDocument();
    // A swipe that ends on the row is not a tap on it.
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("says a set the coach has commented on cannot be deleted, and still lets it be corrected", async () => {
    twoSets();
    comments.value = [{ setId: "b", authorId: "coach_ruairi" }];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    await waitFor(() => expect(screen.getByRole("group", { name: "Set 2" })).toBeInTheDocument());
    await user.click(screen.getByRole("group", { name: "Set 2" }));
    expect(await within(sheet()).findByText(/Your coach has commented on this set/)).toBeInTheDocument();
    expect(within(sheet()).queryByRole("button", { name: "Delete Set 2" })).not.toBeInTheDocument();
    await type(user, "155");
    await user.click(screen.getByRole("button", { name: "Save Set 2" }));
    expect(editSet.mock.calls[0][1]).toMatchObject({ loadKg: 155 });
  });

  it("brings the untouched row behind along when the latest set is corrected", async () => {
    // The mistype that started this: 14 for 140, then Add set repeats it.
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of "14") await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Add a set to Squat" }));
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("14");

    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await type(user, "140");
    await user.click(screen.getByRole("button", { name: "Save Set 1" }));
    expect(screen.getByLabelText("Set 2 weight in kilograms")).toHaveTextContent("140");
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
    expect(logSet.mock.calls[1][0]).toMatchObject({ loadKg: 140, reps: 5, setIndex: 2 });
  });

  it("moves the coach's next target when a working set becomes a warm-up in the sheet", async () => {
    library.exercises = [squat];
    prescribed.value = {
      status: "ready",
      day: {
        program: { id: "p1" },
        week: { id: "w1" },
        day: { id: "d1", label: "Day 1", notes: null },
        prescriptions: [
          {
            id: "sq", exerciseId: "squat", position: 0, setCount: 2, reps: 5, load: "75%",
            programId: "p1", weekId: "w1", dayId: "d1", repMax: null, restSeconds: null, notes: null,
            loadKind: null, updatedAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
      maxes: {
        entries: [
          { id: "m1", exerciseId: "squat", kind: "training", valueKg: 200, effectiveFrom: "2026-01-01T00:00:00Z", recordedBy: "coach" },
        ],
        estimated: new Map(),
      },
    };
    storedSets.value = [logged("a", 150, 20, { setIndex: 1 })];
    const { user } = setup({ active: session({ programDayId: "d1" }) });
    expect(await screen.findByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 2 of 2");
    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(within(sheet()).getByRole("switch", { name: "Warm-up" }));
    await user.click(screen.getByRole("button", { name: "Save Set 1" }));
    expect(screen.getByRole("list", { name: "Squat prescribed" })).toHaveTextContent("Next: Set 1 of 2");
  });

  describe("records and last time follow the correction", () => {
    const bests = { e1rmKg: 170, heaviestKg: 150, repsAt: [{ loadKg: 140, reps: 6 }] };

    it("badges a set an edit makes a record, pops it in, and takes the badge away when edited back", async () => {
      const vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
      Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
      onTestFinished(() => {
        delete (navigator as unknown as Record<string, unknown>).vibrate;
      });
      exerciseHistory.value.squat = { previous: [], bests };
      storedSets.value = [logged("a", 140, 5)];
      const { user } = setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      expect(screen.queryByRole("img", { name: /personal record/ })).not.toBeInTheDocument();

      await user.click(screen.getByRole("group", { name: "Set 1" }));
      await type(user, "155");
      await user.click(screen.getByRole("button", { name: "Save Set 1" }));
      const badge = await screen.findByRole("img", { name: "Set 1: personal record, heaviest weight" });
      expect(badge.className).toContain("motion-safe:animate-spring-pop");
      // A correction is not a lift: no celebration buzz.
      expect(vibrate.mock.calls.filter((call) => JSON.stringify(call[0]) === JSON.stringify(HAPTICS.success))).toHaveLength(0);

      await user.click(screen.getByRole("group", { name: "Set 1" }));
      await type(user, "145");
      await user.click(screen.getByRole("button", { name: "Save Set 1" }));
      expect(screen.queryByRole("img", { name: /personal record/ })).not.toBeInTheDocument();
    });

    it("finds a rep record at a load once the reps are corrected up (F8's frontier)", async () => {
      exerciseHistory.value.squat = { previous: [], bests };
      storedSets.value = [logged("a", 140, 5, { reps: 6 })];
      const { user } = setup({ active: session() });
      await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      expect(screen.queryByRole("img", { name: /personal record/ })).not.toBeInTheDocument();

      await user.click(screen.getByRole("group", { name: "Set 1" }));
      await user.click(within(sheet()).getByRole("button", { name: "Change reps, now 6" }));
      await type(user, "7");
      await user.click(screen.getByRole("button", { name: "Save Set 1" }));
      expect(await screen.findByRole("img", { name: "Set 1: personal record, most reps at this weight" })).toHaveTextContent(
        "Rep PR",
      );
    });

    it("finds an e1RM record once the RPE is corrected, and lists it at the finish", async () => {
      exerciseHistory.value.squat = { previous: [], bests };
      // 160 x 3 with no RPE estimates nothing; @ 9 it is 174.5 > 170.
      storedSets.value = [logged("a", 148, 5, { reps: 3 })];
      const finish = vi.fn(async () => {
        training.value = { ...training.value, active: null };
      });
      const { user } = setup({ active: session(), finish });
      await screen.findByRole("group", { name: "Set 1" });
      await waitFor(() => expect(exerciseHistory.calls).toEqual(["squat"]));
      await user.click(screen.getByRole("group", { name: "Set 1" }));
      await type(user, "160");
      await user.click(within(sheet()).getByRole("button", { name: "Change RPE, now not sure" }));
      await user.click(within(sheet()).getByRole("button", { name: "9" }));
      await user.click(screen.getByRole("button", { name: "Save Set 1" }));
      expect(
        await screen.findByRole("img", { name: "Set 1: personal record, estimated one-rep max and heaviest weight" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Finish session" }));
      await user.click(screen.getByRole("button", { name: "Finish" }));
      const records = await screen.findByRole("region", { name: "Personal records" });
      expect(records).toHaveTextContent("160 kg × 3 @ 9");
    });

    it("lines the Previous column up again when an edit turns a set into a warm-up", async () => {
      exerciseHistory.value.squat = { previous: [prev(60, 5, true), prev(140, 5)], bests: null };
      storedSets.value = [logged("a", 60, 20), logged("b", 140, 10)];
      const { user } = setup({ active: session() });
      const previousOf = (row: HTMLElement) => row.closest("div.flex-col")?.querySelector("[data-previous]") ?? null;
      // Both logged as working: set 1 lines up with last time's working set.
      await waitFor(() => expect(previousOf(screen.getByRole("group", { name: "Set 1" }))).toHaveTextContent("140 × 5"));

      await user.click(screen.getByRole("group", { name: "Set 1" }));
      await user.click(within(sheet()).getByRole("switch", { name: "Warm-up" }));
      await user.click(screen.getByRole("button", { name: "Save Set 1" }));
      expect(previousOf(screen.getByRole("group", { name: "Warm-up set" }))).toHaveTextContent("60 × 5");
      expect(previousOf(screen.getByRole("group", { name: "Set 1" }))).toHaveTextContent("140 × 5");
    });
  });

  describe("with no signal", () => {
    it("queues the edit behind the set's own create with the rollup behind it, and a reload shows it", async () => {
      const store = useRealQueue();
      const { user, unmount } = setup({ active: session() });
      await addSquat(user);
      await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
      for (const key of "140") await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Reps" }));
      await user.click(screen.getByRole("button", { name: "5" }));
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(async () => expect((await store.all()).some((op) => op.kind === "rollup.refresh")).toBe(true));
      await act(async () => {
        await Promise.resolve();
      });

      await user.click(screen.getByRole("group", { name: "Set 1" }));
      await type(user, "142.5");
      await user.click(within(sheet()).getByRole("button", { name: "Reps" }));
      await type(user, "4");
      await user.click(within(sheet()).getByRole("button", { name: "RPE" }));
      await user.click(within(sheet()).getByRole("button", { name: "8.5" }));
      await user.click(screen.getByRole("button", { name: "Save Set 1" }));
      // On screen at once, still marked queued: nothing has reached Appwrite.
      expect(screen.getByRole("group", { name: "Set 1" })).toHaveTextContent("142.5");

      await waitFor(async () => {
        const ops = (await store.all()).sort((a, b) => a.sequence - b.sequence);
        const create = ops.find((op) => op.kind === "set.create");
        const edit = ops.find((op) => op.kind === "set.update");
        // Exactly the four values and the note (none, so cleared): the clip, the
        // time and the prescription are not the edit's to touch.
        expect(edit?.payload).toEqual({
          setId: create?.payload.setId,
          loadKg: 142.5,
          reps: 4,
          rpe: 8.5,
          isWarmup: false,
          failed: false,
          notes: null,
        });
        expect(edit!.sequence).toBeGreaterThan(create!.sequence);
        const refreshes = ops.filter((op) => op.kind === "rollup.refresh");
        expect(refreshes.at(-1)!.sequence).toBeGreaterThan(edit!.sequence);
      });

      unmount();
      setup({ active: session() });
      const row = await screen.findByRole("group", { name: "Set 1" });
      expect(row).toHaveTextContent("142.5");
      expect(screen.getByLabelText("Set 1 RPE")).toHaveTextContent("8.5");
      expect(screen.getByText("queued · no signal")).toBeInTheDocument();
    });
  });

  describe("the athlete's note (F11)", () => {
    const noteBox = () => within(sheet()).getByRole("textbox", { name: /^Note on / });

    it("adds a note to the set just logged from its edit sheet, and the row wears it", async () => {
      twoSets();
      const { user } = setup({ active: session() });
      await user.click(await screen.findByRole("group", { name: "Set 2" }));
      await user.click(within(sheet()).getByRole("button", { name: "Add a note to Set 2" }));
      // The pad steps aside for the keyboard.
      expect(within(sheet()).queryByRole("region", { name: /keypad/ })).not.toBeInTheDocument();
      expect(noteBox()).toHaveFocus();
      await user.type(noteBox(), " Hip pinched ");
      await user.click(within(sheet()).getByRole("button", { name: "Save Set 2" }));

      expect(editSet).toHaveBeenCalledTimes(1);
      expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 150, reps: 5, rpe: 8, isWarmup: false, failed: false, notes: "Hip pinched" });
      const row = screen.getByRole("group", { name: "Set 2" }).parentElement!.parentElement!;
      expect(row.querySelector("[data-set-note]")).toHaveTextContent("Hip pinched");
    });

    it("opens on the set's note, and saving it blank clears it", async () => {
      storedSets.value = [logged("a", 140, 20, { setIndex: 1, rpe: 7, notes: "Belt loose" })];
      const { user } = setup({ active: session() });
      const row = await screen.findByRole("group", { name: "Set 1" });
      expect(row.parentElement!.parentElement!.querySelector("[data-set-note]")).toHaveTextContent("Belt loose");

      await user.click(row);
      await user.click(within(sheet()).getByRole("button", { name: "Change note, now: Belt loose" }));
      expect(noteBox()).toHaveValue("Belt loose");
      await user.clear(noteBox());
      await user.click(within(sheet()).getByRole("button", { name: "Save Set 1" }));

      expect(editSet.mock.calls[0][1]).toMatchObject({ notes: null });
      expect(document.querySelector("[data-set-note]")).toBeNull();
    });

    it("writes nothing for an untouched note", async () => {
      storedSets.value = [logged("a", 140, 20, { setIndex: 1, rpe: 7, notes: "Belt loose" })];
      const { user } = setup({ active: session() });
      await user.click(await screen.findByRole("group", { name: "Set 1" }));
      await user.click(within(sheet()).getByRole("button", { name: "Save Set 1" }));
      expect(editSet).not.toHaveBeenCalled();
    });

    it("with no signal, queues the note and shows it again after a reload, through a later warm-up flip", async () => {
      const store = useRealQueue();
      const { user, unmount } = setup({ active: session() });
      await addSquat(user);
      await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
      for (const key of "140") await user.click(screen.getByRole("button", { name: key }));
      await user.click(screen.getByRole("button", { name: "Reps" }));
      await user.click(screen.getByRole("button", { name: "5" }));
      await user.click(screen.getByRole("button", { name: "Log Set 1" }));
      await waitFor(async () => expect((await store.all()).some((op) => op.kind === "rollup.refresh")).toBe(true));
      await act(async () => {
        await Promise.resolve();
      });

      await user.click(screen.getByRole("group", { name: "Set 1" }));
      await user.click(within(sheet()).getByRole("button", { name: "Add a note to Set 1" }));
      await user.type(noteBox(), "Knee caved on rep 4");
      await user.click(screen.getByRole("button", { name: "Save Set 1" }));
      // Then the set number: an edit that says nothing about the note.
      await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));

      await waitFor(async () => {
        const updates = (await store.all()).filter((op) => op.kind === "set.update").sort((a, b) => a.sequence - b.sequence);
        expect(updates).toHaveLength(2);
        expect(updates[0].payload).toMatchObject({ notes: "Knee caved on rep 4" });
        expect("notes" in updates[1].payload).toBe(false);
      });
      expect(document.querySelector("[data-set-note]")).toHaveTextContent("Knee caved on rep 4");

      unmount();
      setup({ active: session() });
      const row = await screen.findByRole("group", { name: "Warm-up set" });
      expect(row.parentElement!.parentElement!.querySelector("[data-set-note]")).toHaveTextContent("Knee caved on rep 4");
      await user.click(row);
      expect(within(sheet()).getByRole("button", { name: "Change note, now: Knee caved on rep 4" })).toBeInTheDocument();
    });
  });
});

/* ------------------------------------------------------------------------ */

describe("the edit sheet over a dimmed page (F16)", () => {
  const sheet = () => screen.getByRole("region", { name: /^Edit / });
  const scrim = () => document.querySelector<HTMLElement>("[data-scrim]");
  const twoSets = () => {
    storedSets.value = [
      logged("a", 140, 20, { setIndex: 1, rpe: 7 }),
      logged("b", 150, 10, { setIndex: 2, rpe: 8 }),
    ];
  };
  beforeEach(() => resetQueueForTests());

  it("puts the edit sheet in a modal over a scrim, and the logging keypad in neither", async () => {
    const { user, unmount } = setup({ active: session() });
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    // Logging: the pinned sheet, the rows still live, nothing dimmed.
    expect(screen.getByRole("region", { name: "Weight, kg keypad" })).toBeInTheDocument();
    expect(scrim()).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();

    twoSets();
    const again = setup({ active: session() });
    await again.user.click(await screen.findByRole("group", { name: "Set 2" }));
    const modal = screen.getByRole("dialog", { name: "Edit Set 2" });
    expect(modal).toContainElement(sheet());
    expect(modal).toContainElement(scrim());
    expect(document.querySelector("[data-log-sheet]")).toBeNull();
  });

  it("closes on a scrim tap when nothing has changed, writing nothing", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 2" }));
    await user.click(scrim()!);
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
    expect(editSet).not.toHaveBeenCalled();
  });

  it("asks before discarding a changed draft; Keep editing keeps it, Discard drops it", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 2" }));
    await user.click(within(sheet()).getByRole("button", { name: "1" }));
    await user.click(within(sheet()).getByRole("button", { name: "6" }));
    await user.click(within(sheet()).getByRole("button", { name: "0" }));

    await user.click(scrim()!);
    const ask = screen.getByRole("dialog", { name: "Discard changes?" });
    expect(ask).toHaveTextContent("Set 2 stays as logged.");
    await user.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    // The draft is still there.
    expect(within(sheet()).getByRole("region", { name: "Weight, kg keypad" })).toHaveTextContent("160");

    // Asked again on the next tap, not swallowed.
    await user.click(scrim()!);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Set 2" })).toHaveTextContent("150");
    expect(editSet).not.toHaveBeenCalled();
  });

  it("treats Escape as the scrim: closes untouched, asks when changed", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Edit Set 1" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: /^Edit / })).not.toBeInTheDocument();

    await user.click(screen.getByRole("group", { name: "Set 1" }));
    await user.click(within(sheet()).getByRole("button", { name: "9" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Edit Set 1" }), { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(sheet()).toBeInTheDocument();
  });

  it("saves from the sheet as before, with no confirm", async () => {
    twoSets();
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 2" }));
    await user.click(within(sheet()).getByRole("button", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "Save Set 2" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes?" })).not.toBeInTheDocument();
    expect(editSet).toHaveBeenCalledTimes(1);
  });
});

describe("a clip from the edit sheet (F17)", () => {
  const sheet = () => screen.getByRole("region", { name: /^Edit / });
  const clip = () => new File([new Uint8Array(16)], "set.mp4", { type: "video/mp4" });
  const pick = async (user: ReturnType<typeof userEvent.setup>) => {
    const input = sheet().querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, clip());
  };
  beforeEach(() => {
    resetQueueForTests();
    attachClipToSet.mockReset();
    retireReplacedClip.mockClear();
  });

  it("offers Add video on a set with no clip, and attaches through the Log's upload path", async () => {
    storedSets.value = [logged("a", 140, 20, { setIndex: 1, rpe: 7 })];
    attachClipToSet.mockResolvedValue({ ok: true, fileId: "file-new" });
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    const video = within(sheet()).getByRole("group", { name: "Video" });
    await user.click(within(video).getByRole("button", { name: "Add video" }));
    await pick(user);

    expect(attachClipToSet).toHaveBeenCalledWith("a", "joey", expect.any(File), expect.anything());
    expect(await within(video).findByRole("button", { name: "Replace video" })).toBeInTheDocument();
    // Nothing to retire.
    expect(retireReplacedClip).not.toHaveBeenCalled();
    // The clip is not part of the draft: closing writes no edit.
    await user.click(document.querySelector<HTMLElement>("[data-scrim]")!);
    expect(editSet).not.toHaveBeenCalled();
  });

  it("offers Replace video on a filmed set and retires the old file once the new attach is queued", async () => {
    storedSets.value = [logged("a", 140, 20, { setIndex: 1, rpe: 7, hasVideo: true, videoFileId: "file-old" })];
    attachClipToSet.mockResolvedValue({ ok: true, fileId: "file-new" });
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    expect(within(sheet()).getByRole("button", { name: "Replace video" })).toBeInTheDocument();
    await pick(user);

    await waitFor(() => expect(retireReplacedClip).toHaveBeenCalledWith("a", "file-old"));

    // A second replace on the same page retires the first replacement, not the original.
    attachClipToSet.mockResolvedValue({ ok: true, fileId: "file-newer" });
    await pick(user);
    await waitFor(() => expect(retireReplacedClip).toHaveBeenLastCalledWith("a", "file-new"));
    expect(retireReplacedClip).toHaveBeenCalledTimes(2);
  });

  it("leaves the old file alone while the replacement is still pending", async () => {
    storedSets.value = [logged("a", 140, 20, { setIndex: 1, rpe: 7, hasVideo: true, videoFileId: "file-old" })];
    attachClipToSet.mockResolvedValue({ ok: false, reason: "pending", message: "It will carry on by itself." });
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await pick(user);
    expect(await within(sheet()).findByText("It will carry on by itself.")).toBeInTheDocument();
    expect(retireReplacedClip).not.toHaveBeenCalled();
  });

  it("holds Delete back while the clip uploads", async () => {
    storedSets.value = [logged("a", 140, 20, { setIndex: 1, rpe: 7 })];
    let finish: (value: unknown) => void = () => {};
    attachClipToSet.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await pick(user);
    expect(within(sheet()).getByRole("button", { name: "Delete Set 1" })).toBeDisabled();
    await act(async () => finish({ ok: true, fileId: "file-new" }));
    expect(within(sheet()).getByRole("button", { name: "Delete Set 1" })).toBeEnabled();
  });
});

describe("marking a set failed (F19)", () => {
  const addSquat = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("combobox"), "squat");
    await user.click(screen.getByRole("option", { name: "Squat" }));
  };
  const sheet = () => screen.getByRole("region", { name: /^Edit / });
  beforeEach(() => resetQueueForTests());

  it("logs a missed single as load x 0 from the keypad's switch, marked on the row", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    for (const key of ["2", "0", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "0" }));
    // 0 reps is not a set until it is a missed one.
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: "Failed" }));
    expect(screen.getByRole("switch", { name: "Failed" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("img", { name: "Set 1: failed" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ loadKg: 200, reps: 0, failed: true, isWarmup: false });
    expect(await screen.findByRole("img", { name: "Set 1: failed" })).toBeInTheDocument();
  });

  it("marks it from the RPE chips too, without closing them, and the RPE still goes with it", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    for (const key of ["1", "8", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "3" }));
    await user.click(screen.getByRole("button", { name: "RPE" }));
    await user.click(screen.getByRole("switch", { name: "Failed" }));
    // Still on the chips.
    expect(screen.getByRole("region", { name: "RPE for set 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "10" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ loadKg: 180, reps: 3, rpe: 10, failed: true });
  });

  it("logs a made set as not failed", async () => {
    const { user } = setup({ active: session() });
    await addSquat(user);
    await user.click(screen.getByRole("button", { name: "Set 1 weight in kilograms" }));
    for (const key of ["1", "4", "0"]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ failed: false });
    expect(screen.queryByRole("img", { name: /failed/ })).not.toBeInTheDocument();
  });

  it("badges no record for a failed set, and a made set after it is still measured against the old bests", async () => {
    exerciseHistory.value.squat = { previous: [], bests: { e1rmKg: 170, heaviestKg: 150 } };
    storedSets.value = [
      // Heavier than ever, but missed.
      logged("miss", 160, 10, { reps: 0, rpe: 10, failed: true }),
      // Heavier than the old 150, made: a weight record, even after the miss at 160.
      logged("made", 155, 5, { reps: 1, rpe: 9 }),
    ];
    setup({ active: session() });
    await screen.findByRole("img", { name: "Set 1: failed" });
    expect(await screen.findByRole("img", { name: /Set 2: personal record/ })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Set 1: personal record/ })).not.toBeInTheDocument();
  });

  it("shows a set missed last time in its Previous line, marked", async () => {
    exerciseHistory.value.squat = {
      previous: [{ loadKg: 200, reps: 0, isWarmup: false, failed: true }],
      bests: null,
    };
    storedSets.value = [logged("a", 190, 5, { reps: 1, rpe: 9 })];
    setup({ active: session() });
    const row = await screen.findByRole("group", { name: "Set 1" });
    await waitFor(() =>
      expect(row.closest("div.flex-col")?.querySelector("[data-previous]")).toHaveTextContent("200 × 0 · failed"),
    );
  });

  it("keeps the flag through the set number's warm-up flip", async () => {
    storedSets.value = [logged("a", 200, 20, { reps: 0, rpe: 10, failed: true }), logged("b", 140, 10, { rpe: 8 })];
    const { user } = setup({ active: session() });
    await screen.findByRole("group", { name: "Set 2" });
    await user.click(screen.getByRole("button", { name: "Set 1: mark as warm-up" }));
    expect(editSet.mock.calls[0][1]).toEqual({ loadKg: 200, reps: 0, rpe: null, isWarmup: true, failed: true });
  });

  it("corrects a logged set to failed from the edit sheet, and back", async () => {
    storedSets.value = [logged("a", 180, 20, { setIndex: 1, reps: 3, rpe: 9 })];
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await user.click(within(sheet()).getByRole("switch", { name: "Failed" }));
    expect(within(sheet()).getByRole("button", { name: "Change reps, now 3, failed set" })).toBeInTheDocument();
    await user.click(within(sheet()).getByRole("button", { name: "Save Set 1" }));
    expect(editSet).toHaveBeenCalledTimes(1);
    expect(editSet.mock.calls[0][1]).toMatchObject({ loadKg: 180, reps: 3, rpe: 9, failed: true });
    expect(await screen.findByRole("img", { name: "Set 1: failed" })).toBeInTheDocument();

    await user.click(screen.getByRole("group", { name: "Set 1" }));
    expect(within(sheet()).getByRole("switch", { name: "Failed" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(sheet()).getByRole("switch", { name: "Failed" }));
    await user.click(within(sheet()).getByRole("button", { name: "Save Set 1" }));
    expect(editSet.mock.calls[1][1]).toMatchObject({ failed: false });
    await waitFor(() => expect(screen.queryByRole("img", { name: "Set 1: failed" })).not.toBeInTheDocument());
  });
});

/* ------------------------------------------------------------------------ */

describe("bodyweight exercises at 0 kg (F20)", () => {
  const pullUp: Exercise = {
    id: "pull-up",
    name: "Pull Up",
    normalisedName: "pull up",
    isGlobal: true,
    isBodyweight: true,
  };
  const add = async (user: ReturnType<typeof userEvent.setup>, query: string, name: string) => {
    await user.type(screen.getByRole("combobox"), query);
    await user.click(screen.getByRole("option", { name }));
  };
  const enter = async (user: ReturnType<typeof userEvent.setup>, kg: string, reps: string) => {
    await user.click(screen.getByRole("button", { name: /weight in kilograms/ }));
    for (const key of [...kg]) await user.click(screen.getByRole("button", { name: key }));
    await user.click(screen.getByRole("button", { name: "Reps" }));
    for (const key of [...reps]) await user.click(screen.getByRole("button", { name: key }));
  };
  const sheet = () => screen.getByRole("region", { name: /^Edit / });
  beforeEach(() => {
    resetQueueForTests();
    library.exercises = [squat, pullUp];
  });

  it("logs a pull-up at 0 kg, with no hint and the confirm live", async () => {
    const { user } = setup({ active: session() });
    await add(user, "pull", "Pull Up");
    await enter(user, "0", "12");

    expect(document.querySelector('[data-blocker="zero-load"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ exerciseId: "pull-up", loadKg: 0, reps: 12 });
  });

  it("repeats 0 kg on Add set, so the next set at bodyweight is one tap", async () => {
    const { user } = setup({ active: session() });
    await add(user, "pull", "Pull Up");
    await enter(user, "0", "10");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await user.click(screen.getByRole("button", { name: "Add a set to Pull Up" }));
    await user.click(screen.getByRole("button", { name: "Log Set 2" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(2));
    expect(logSet.mock.calls[1][0]).toMatchObject({ loadKg: 0, reps: 10, setIndex: 2 });
  });

  it("keeps added load on a pull-up logging as before", async () => {
    const { user } = setup({ active: session() });
    await add(user, "pull", "Pull Up");
    await enter(user, "20", "5");
    await user.click(screen.getByRole("button", { name: "Log Set 1" }));
    await waitFor(() => expect(logSet).toHaveBeenCalledTimes(1));
    expect(logSet.mock.calls[0][0]).toMatchObject({ loadKg: 20, reps: 5 });
  });

  it("still refuses 0 kg on a squat, and the row says why", async () => {
    const { user } = setup({ active: session() });
    await add(user, "squat", "Squat");
    await enter(user, "0", "5");

    const confirm = screen.getByRole("button", { name: "Log Set 1" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription("0 kg logs only on a bodyweight exercise");
    await user.click(confirm);
    expect(logSet).not.toHaveBeenCalled();
  });

  it("refuses 0 kg on an exercise from a library cached before the flag existed", async () => {
    // What a phone that has not fetched since v20 holds: no field at all.
    library.exercises = [{ id: "pull-up", name: "Pull Up", normalisedName: "pull up", isGlobal: true }];
    const { user } = setup({ active: session() });
    await add(user, "pull", "Pull Up");
    await enter(user, "0", "12");
    expect(screen.getByRole("button", { name: "Log Set 1" })).toBeDisabled();
  });

  it("saves a correction to 0 kg on a pull-up from the edit sheet", async () => {
    storedSets.value = [logged("a", 10, 20, { exerciseId: "pull-up", setIndex: 1, reps: 8 })];
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await user.click(within(sheet()).getByRole("button", { name: "0" }));

    expect(within(sheet()).queryByText("0 kg logs only on a bodyweight exercise")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save Set 1" }));
    expect(editSet).toHaveBeenCalledTimes(1);
    expect(editSet.mock.calls[0][1]).toMatchObject({ loadKg: 0, reps: 8 });
  });

  it("will not save a squat corrected to 0 kg, and says why", async () => {
    storedSets.value = [logged("a", 140, 20, { setIndex: 1 })];
    const { user } = setup({ active: session() });
    await user.click(await screen.findByRole("group", { name: "Set 1" }));
    await user.click(within(sheet()).getByRole("button", { name: "0" }));

    const save = screen.getByRole("button", { name: "Save Set 1" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("0 kg logs only on a bodyweight exercise");
  });
});
