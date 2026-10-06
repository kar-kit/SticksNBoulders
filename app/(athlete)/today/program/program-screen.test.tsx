import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProgramScreen } from "./program-screen";
import type { SessionRecord } from "@/lib/logging/session";
import type { ProgramTree } from "@/lib/programming/program";
import type { MyProgramState } from "@/lib/programming/use-my-program";
import type { AthleteMaxes } from "@/lib/programming/use-prescribed";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } },
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/exercises/library-context", () => ({
  useExerciseLibrary: () => ({
    state: {
      status: "ready",
      exercises: [
        { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
        { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
      ],
    },
    remember: vi.fn(),
    reload: vi.fn(),
  }),
}));

const training = vi.hoisted(() => ({
  value: {} as ReturnType<typeof import("@/lib/logging/session-context").useTrainingSessions>,
}));
vi.mock("@/lib/logging/session-context", () => ({ useTrainingSessions: () => training.value }));

const badge = vi.hoisted(() => ({ hasCoach: null as boolean | null, unread: 0 }));
vi.mock("@/lib/review/feedback-context", () => ({ useFeedbackBadge: () => badge }));

const loaded = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/programming/use-my-program", () => ({ useMyProgram: () => loaded.value }));

const NO_MAXES: AthleteMaxes = { entries: [], estimated: new Map() };
const day = (id: string, weekId: string, scheduledOn: string | null, label: string, over = {}) => ({
  id,
  programId: "p1",
  blockId: "b1",
  weekId,
  position: 0,
  label,
  scheduledOn,
  notes: null,
  prescriptions: [
    {
      id: `${id}-l1`,
      programId: "p1",
      weekId,
      dayId: id,
      exerciseId: "squat",
      position: 0,
      setCount: 3,
      reps: 5,
      repMax: null,
      load: "75%",
      loadKind: "percent" as const,
      restSeconds: null,
      notes: null,
      updatedAt: "",
    },
  ],
  ...over,
});
const week = (id: string, position: number, days: ReturnType<typeof day>[], over = {}) => ({
  id,
  programId: "p1",
  blockId: "b1",
  position,
  label: null,
  status: "published" as const,
  notes: null,
  days,
  ...over,
});
const tree = (weeks: ReturnType<typeof week>[], over: Partial<ProgramTree> = {}): ProgramTree => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Peaking block",
  status: "published",
  startOn: null,
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "",
  blocks: [{ id: "b1", programId: "p1", position: 0, name: "Volume", notes: null, weeks }],
  ...over,
});
const ready = (program: ProgramTree, maxes: AthleteMaxes = NO_MAXES): MyProgramState => ({ status: "ready", program, maxes });

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  clientSessionId: "c1",
  startedAt: new Date("2026-10-05T09:00:00Z"),
  finishedAt: new Date("2026-10-05T10:00:00Z"),
  setCount: 3,
  tonnageKg: 1000,
  ...over,
});

function setup(overrides: Partial<typeof training.value> = {}) {
  const start = vi.fn(async () => session());
  training.value = {
    state: { status: "ready", sessions: [] },
    active: null,
    lastFinished: null,
    start,
    finish: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  } as typeof training.value;
  render(<ProgramScreen />);
  return { start, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00"));
  badge.hasCoach = true;
  loaded.value = { status: "loading", program: null, maxes: NO_MAXES };
});
afterEach(() => vi.useRealTimers());

describe("My Program, empty states", () => {
  it("says there is no coach, with no action and no upsell", () => {
    badge.hasCoach = false;
    loaded.value = { status: "none", program: null, maxes: NO_MAXES };
    setup();
    expect(screen.getByText("No coach linked")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("No program yet")).not.toBeInTheDocument();
  });

  it("does not show a cached block once the coach link is gone", () => {
    badge.hasCoach = false;
    loaded.value = ready(tree([week("w1", 0, [day("d1", "w1", "2026-10-06", "Squat day")])]));
    setup();
    expect(screen.getByText("No coach linked")).toBeInTheDocument();
    expect(screen.queryByText("Squat day")).not.toBeInTheDocument();
  });

  it("says a linked coach has not published", () => {
    loaded.value = { status: "none", program: null, maxes: NO_MAXES };
    setup();
    expect(screen.getByText("No program yet")).toBeInTheDocument();
    expect(screen.getByText(/has not published/)).toBeInTheDocument();
  });

  it("renders nothing alarming while loading or offline with nothing cached", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/error|failed/i)).not.toBeInTheDocument();
  });

  it("words the first-ever offline load as a fact, not an error", () => {
    loaded.value = { status: "failed", program: null, maxes: NO_MAXES };
    setup();
    expect(screen.getByText("Program not loaded")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("My Program, with a block", () => {
  const block = () =>
    tree([
      week("w1", 0, [day("d1", "w1", "2026-10-01", "Opener")]),
      week("w2", 1, [
        day("d2", "w2", "2026-10-05", "Heavy squat", { notes: "Keep the top set honest." }),
        day("d3", "w2", "2026-10-09", "Bench"),
      ]),
      week("w3", 2, [day("d4", "w3", "2026-10-12", "Next week")]),
    ]);

  it("opens the current week and collapses the rest", () => {
    loaded.value = ready(block());
    setup();
    expect(screen.getByRole("button", { name: /Week 2/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Week 1/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Heavy squat")).toBeInTheDocument();
    expect(screen.queryByText("Next week")).not.toBeInTheDocument();
  });

  it("labels done, missed and upcoming days, with no streaks", async () => {
    loaded.value = ready(block());
    const { user } = setup({
      state: { status: "ready", sessions: [session({ programDayId: "d2" })] },
    });
    await user.click(screen.getByRole("button", { name: /Week 1/ }));
    const missed = screen.getByRole("button", { name: /Opener/ });
    expect(within(missed).getByText("Missed")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Heavy squat/ })).getByText("Done")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Bench/ })).queryByText(/Done|Missed|Today/)).toBeNull();
    expect(screen.getByText("1 of 4 sessions logged")).toBeInTheDocument();
    expect(screen.queryByText(/streak|keep it up|well done/i)).not.toBeInTheDocument();
  });

  it("opens a day to its lines with percentages already in kilos, and the coach's note", async () => {
    loaded.value = ready(block(), {
      entries: [
        { id: "m", exerciseId: "squat", kind: "training", valueKg: 200, effectiveFrom: "2026-09-01T00:00:00Z", recordedBy: "ruairi" },
      ],
      estimated: new Map(),
    });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Heavy squat/ }));
    expect(screen.getByText("Squat")).toBeInTheDocument();
    expect(screen.getByText(/3 × 5 · 150 kg \(75%\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Coach's note")).toHaveTextContent("Keep the top set honest.");
  });

  it("starts the opened day through the same path as Today", async () => {
    loaded.value = ready(block());
    const { user, start } = setup();
    await user.click(screen.getByRole("button", { name: /Bench/ }));
    await user.click(screen.getByRole("button", { name: "Start this session" }));
    expect(start).toHaveBeenCalledWith({ programDayId: "d3" });
    expect(push).toHaveBeenCalledWith("/log");
  });

  it("offers Resume, not a second start, while a session is running", async () => {
    loaded.value = ready(block());
    const { user, start } = setup({ active: session({ finishedAt: null }) });
    await user.click(screen.getByRole("button", { name: /Bench/ }));
    await user.click(screen.getByRole("button", { name: "Resume session" }));
    expect(start).toHaveBeenCalledWith(undefined);
  });

  it("links a done day to its logged session and offers no Start", async () => {
    loaded.value = ready(block());
    const { user } = setup({ state: { status: "ready", sessions: [session({ id: "sess9", programDayId: "d2" })] } });
    await user.click(screen.getByRole("button", { name: /Heavy squat/ }));
    expect(screen.getByRole("link", { name: "View logged session" })).toHaveAttribute("href", "/history/sess9");
    expect(screen.queryByRole("button", { name: "Start this session" })).not.toBeInTheDocument();
  });

  it("says nothing was lost when a start fails", async () => {
    loaded.value = ready(block());
    const start = vi.fn(async () => {
      throw new Error("no signal");
    });
    const { user } = setup({ start: start as never });
    await user.click(screen.getByRole("button", { name: /Bench/ }));
    await user.click(screen.getByRole("button", { name: "Start this session" }));
    expect(await screen.findByText(/Nothing was lost/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("is read-only: no edit, delete or add controls anywhere", async () => {
    loaded.value = ready(block());
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Bench/ }));
    expect(screen.queryByRole("button", { name: /edit|delete|add|remove|publish/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows completion for a finished block", () => {
    vi.setSystemTime(new Date("2026-11-01T12:00:00"));
    loaded.value = ready(block());
    setup({ state: { status: "ready", sessions: [session({ programDayId: "d2" })] } });
    expect(screen.getByRole("status")).toHaveTextContent("Block finished · 1 of 4 sessions logged");
  });
});
