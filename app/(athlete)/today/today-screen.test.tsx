import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodayScreen } from "./today-screen";
import type { SessionRecord } from "@/lib/logging/session";
import type { Prescription } from "@/lib/programming/program";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const training = vi.hoisted(() => ({
  value: {} as ReturnType<typeof import("@/lib/logging/session-context").useTrainingSessions>,
}));
vi.mock("@/lib/logging/session-context", () => ({
  useTrainingSessions: () => training.value,
}));

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

type Prescribed = ReturnType<typeof import("@/lib/programming/use-prescribed").usePrescribedToday>;
const NONE: Prescribed = { status: "none", day: null, maxes: { entries: [], estimated: new Map() } };
const prescribed = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/programming/use-prescribed", () => ({
  usePrescribedToday: () => prescribed.value,
}));

const badge = vi.hoisted(() => ({ hasCoach: null as boolean | null, unread: 0 }));
vi.mock("@/lib/review/feedback-context", () => ({
  useFeedbackBadge: () => badge,
}));

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  clientSessionId: "c1",
  startedAt: new Date("2026-09-14T09:00:00Z"),
  finishedAt: null,
  setCount: 0,
  tonnageKg: 0,
  ...overrides,
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
  render(<TodayScreen />);
  return { start, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  prescribed.value = NONE;
  badge.hasCoach = null;
  badge.unread = 0;
});

describe("Today, with no program", () => {
  it("says what day it is and that nothing is prescribed", () => {
    setup();
    expect(screen.getByText("Nothing prescribed today.")).toBeInTheDocument();
  });

  it("offers to start on an entirely empty account", () => {
    // Ruairi's first morning. An empty screen that looks broken makes the beta
    // look broken.
    setup();
    expect(screen.getByText("No sessions logged yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a session" })).toBeInTheDocument();
  });

  it("names the last session once there is one", () => {
    setup({ lastFinished: session({ startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date() }) });
    expect(screen.getByText("Last session: Thu")).toBeInTheDocument();
  });

  it("carries no streaks, badges or encouragement", () => {
    // The audience is competitive powerlifters with a coach. The coach supplies
    // the motivation.
    setup({ lastFinished: session({ finishedAt: new Date() }) });
    expect(screen.queryByText(/streak|keep it up|well done|nice work|day in a row/i)).not.toBeInTheDocument();
  });
});

describe("starting and resuming", () => {
  it("starts a session and goes to the logger", async () => {
    const { user, start } = setup();
    await user.click(screen.getByRole("button", { name: "Start a session" }));

    expect(start).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/log");
  });

  it("offers Resume when one is already running", () => {
    setup({ active: session() });
    expect(screen.getByRole("button", { name: "Resume session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a session" })).not.toBeInTheDocument();
  });

  it("shows how long the running session has been going", () => {
    setup({ active: session({ startedAt: new Date(Date.now() - 47 * 60_000 - 12_000) }) });
    expect(screen.getByText(/Session running · 0:47:1\d/)).toBeInTheDocument();
  });

  it("says nothing was lost when a start fails, and leaves the button ready", async () => {
    const start = vi.fn(async () => {
      throw new Error("no signal");
    });
    const { user } = setup({ start: start as never });
    await user.click(screen.getByRole("button", { name: "Start a session" }));

    expect(await screen.findByText(/Nothing was lost/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a session" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Today, with a prescribed day", () => {
  const line = (over: Partial<Prescription>): Prescription => ({
    id: "l",
    exerciseId: "squat",
    position: 0,
    setCount: 1,
    load: null,
    loadKind: null,
    programId: "p1",
    weekId: "w1",
    dayId: "d1",
    reps: 5,
    repMax: null,
    restSeconds: null,
    notes: null,
    updatedAt: "2026-09-20T00:00:00Z",
    ...over,
  });

  const ready = (): Prescribed => ({
    status: "ready",
    day: {
      program: {
        id: "p1",
        coachId: "ruairi",
        athleteId: "joey",
        name: "Block 1",
        status: "published",
        startOn: null,
        notes: null,
        templateId: null,
        createdAt: "",
        updatedAt: "",
      },
      week: { id: "w1", programId: "p1", blockId: "b1", position: 0, label: null, status: "published", notes: null },
      day: {
        id: "d1",
        programId: "p1",
        blockId: "b1",
        weekId: "w1",
        position: 0,
        label: "Week 1 · Day 1",
        scheduledOn: "2026-09-27",
        notes: "Keep the top set honest.",
      },
      prescriptions: [
        line({ id: "l1", exerciseId: "squat", position: 0, setCount: 1, load: "@8", loadKind: "rpe" }),
        line({ id: "l2", exerciseId: "bench", position: 1, setCount: 4, reps: 6, load: "72.5% @8", loadKind: "capped" }),
      ],
    },
    maxes: {
      entries: [
        {
          id: "m1",
          exerciseId: "bench",
          kind: "training",
          valueKg: 120,
          effectiveFrom: "2026-09-01T00:00:00Z",
          recordedBy: "ruairi",
        },
      ],
      estimated: new Map(),
    },
  });

  it("names the day and previews every exercise with its lines", () => {
    prescribed.value = ready();
    setup();
    expect(screen.getByText("Week 1 · Day 1")).toBeInTheDocument();
    expect(screen.queryByText("Nothing prescribed today.")).not.toBeInTheDocument();
    expect(screen.getByText("Squat")).toBeInTheDocument();
    expect(screen.getByText("1 × 5 · RPE 8")).toBeInTheDocument();
  });

  it("turns a percentage into kilos against the training max, rounded down", () => {
    // 72.5% of 120 is 87 -- rounded down to 85, never up to 87.5.
    prescribed.value = ready();
    setup();
    expect(screen.getByText("4 × 6 · 85 kg (72.5%), stop at RPE 8")).toBeInTheDocument();
  });

  it("shows the coach's note for the day under the card", () => {
    prescribed.value = ready();
    setup();
    expect(screen.getByLabelText("Coach's note")).toHaveTextContent("Keep the top set honest.");
  });

  it("starts the prescribed session linked to its day", async () => {
    prescribed.value = ready();
    const { user, start } = setup();
    await user.click(screen.getByRole("button", { name: "Start today's session" }));
    expect(start).toHaveBeenCalledWith({ programDayId: "d1" });
    expect(push).toHaveBeenCalledWith("/log");
  });

  it("keeps free logging one tap away", async () => {
    prescribed.value = ready();
    const { user, start } = setup();
    await user.click(screen.getByRole("button", { name: "Log something else" }));
    expect(start).toHaveBeenCalledWith(undefined);
  });

  it("offers Resume over the prescribed day when a session is already running", () => {
    prescribed.value = ready();
    setup({ active: session() });
    expect(screen.getByRole("button", { name: "Resume session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start today's session" })).not.toBeInTheDocument();
  });
});

describe("Today, the way into Coach Feedback", () => {
  it("is absent for an athlete training solo", () => {
    badge.hasCoach = false;
    setup();
    expect(screen.queryByRole("link", { name: /Coach feedback/ })).not.toBeInTheDocument();
  });

  it("waits rather than flickering in before the link is known", () => {
    setup();
    expect(screen.queryByRole("link", { name: /Coach feedback/ })).not.toBeInTheDocument();
  });

  it("is there once they have a coach, quiet when nothing is new", () => {
    badge.hasCoach = true;
    setup();
    const link = screen.getByRole("link", { name: /Coach feedback/ });
    expect(link).toHaveAttribute("href", "/today/feedback");
    expect(link).toHaveTextContent("Nothing new");
  });

  it("says how much is new", () => {
    badge.hasCoach = true;
    badge.unread = 3;
    setup();
    expect(screen.getByRole("link", { name: /Coach feedback/ })).toHaveTextContent("3 new");
  });
});
