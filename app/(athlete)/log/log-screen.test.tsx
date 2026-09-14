import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogScreen } from "./log-screen";
import type { SessionRecord } from "@/lib/logging/session";
import type { Exercise } from "@/lib/exercises/match";

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
  library.exercises = [squat];
  storedSets.value = [];
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

    expect(await screen.findByText("Squat")).toBeInTheDocument();
    expect(screen.getByText("No sets yet")).toBeInTheDocument();
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
    expect(await screen.findByText("Zercher Squat")).toBeInTheDocument();
  });

  it("rebuilds its exercises from the sets when a session is resumed", async () => {
    // There is no session_exercises table: an exercise is in a session because
    // work was logged against it, so resuming reads the work back.
    storedSets.value = [
      { exerciseId: "squat", loadKg: 142.5, reps: 5, isWarmup: false, loggedAt: new Date() },
      { exerciseId: "squat", loadKg: 142.5, reps: 5, isWarmup: false, loggedAt: new Date() },
    ];
    setup({ active: session() });

    expect(await screen.findByText("Squat")).toBeInTheDocument();
    expect(screen.getByText("2 sets")).toBeInTheDocument();
  });

  it("shows an unknown exercise by its id rather than hiding real work", async () => {
    library.exercises = [];
    storedSets.value = [
      { exerciseId: "mystery", loadKg: 100, reps: 5, isWarmup: false, loggedAt: new Date() },
    ];
    setup({ active: session() });
    expect(await screen.findByText("mystery")).toBeInTheDocument();
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
      { exerciseId: "squat", loadKg: 100, reps: 5, isWarmup: true, loggedAt: new Date() },
      { exerciseId: "squat", loadKg: 142.5, reps: 5, isWarmup: false, loggedAt: new Date() },
    ];
    const { user, finish } = setup({ active: session() });
    await screen.findByText("Squat");

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
