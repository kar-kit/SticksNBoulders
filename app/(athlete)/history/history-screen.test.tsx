import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryScreen } from "./history-screen";
import type { SessionRecord } from "@/lib/logging/session";
import type { Exercise } from "@/lib/exercises/match";
import type { HistorySet } from "@/lib/logging/history-store";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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

const exercises: Exercise[] = [
  { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
  { id: "dead", name: "Deadlift", normalisedName: "deadlift", isGlobal: true },
];

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  clientSessionId: "s1",
  startedAt: new Date(Date.now() - 2 * 60 * 60_000),
  finishedAt: new Date(Date.now() - 60 * 60_000),
  setCount: 8,
  tonnageKg: 4200,
  notes: null,
  ...over,
});

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
  loggedAt: new Date(Date.now() - 90 * 60_000),
  ...over,
});

function setup(sessions: SessionRecord[] = [session()]) {
  training.value = {
    state: { status: "ready", sessions },
    active: null,
    lastFinished: null,
    start: vi.fn(),
    finish: vi.fn(),
    reload: vi.fn(),
  };
  render(<HistoryScreen />);
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  library.exercises = exercises;
  loaded.sets = [set()];
});

describe("with no history", () => {
  it("says so, and does not offer a search box for nothing", async () => {
    // Ruairi's first morning is an entirely empty account.
    setup([]);
    expect(await screen.findByText("No sessions yet")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});

describe("the list", () => {
  it("groups sessions under the week they were done", async () => {
    setup();
    expect(await screen.findByRole("region", { name: "This week" })).toBeInTheDocument();
  });

  it("shows what a session was, without opening it", async () => {
    setup();
    const card = await screen.findByRole("link", { name: /8 sets/ });
    expect(card).toHaveTextContent("Squat");
    expect(card).toHaveTextContent("8 sets");
    expect(card).toHaveTextContent("4,200 kg");
  });

  it("takes its totals from the session, not from the sets on screen", async () => {
    // The finish screen showed these numbers. Recomputing from the one set
    // that happens to be loaded would show "1 set" for an eight-set session.
    setup();
    expect(await screen.findByText(/8 sets/)).toBeInTheDocument();
  });

  it("opens the session when tapped", async () => {
    setup();
    expect(await screen.findByRole("link", { name: /8 sets/ })).toHaveAttribute(
      "href",
      "/history/s1",
    );
  });

  it("shows a running session as running rather than with a duration", async () => {
    setup([session({ finishedAt: null })]);
    expect(await screen.findByText(/running/)).toBeInTheDocument();
  });
});

describe("search", () => {
  it("answers the query people actually have", async () => {
    // "Show me my deadlift sessions" -- the blueprint's words.
    loaded.sets = [
      set({ sessionId: "s1", exerciseId: "squat" }),
      set({ sessionId: "s2", clientSetId: "st-2", exerciseId: "dead" }),
    ];
    const { user } = setup([session(), session({ id: "s2", clientSessionId: "s2", setCount: 5 })]);

    await screen.findByRole("link", { name: /8 sets/ });
    await user.type(screen.getByRole("searchbox", { name: "Search by exercise" }), "deadlift");

    await waitFor(() => expect(screen.queryByRole("link", { name: /8 sets/ })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /5 sets/ })).toBeInTheDocument();
  });

  it("says nothing matched rather than showing an empty page", async () => {
    const { user } = setup();
    await screen.findByRole("link", { name: /8 sets/ });
    await user.type(screen.getByRole("searchbox"), "curl");
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing matching");
  });
});
