import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiftScreen } from "./lift-screen";
import type { Exercise } from "@/lib/exercises/match";
import type { WeekPoint } from "@/lib/strength/lift";
import type { LiftSet } from "@/lib/strength/lift-store";

const back = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push: vi.fn() }) }));

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

const data = vi.hoisted(() => ({ weeks: [] as unknown[], sets: [] as unknown[] }));
vi.mock("@/lib/strength/lift-store", () => ({
  fetchLiftWeeks: async () => data.weeks,
  fetchRecentSetsFor: async () => data.sets,
}));

/** Weeks counted back from now, so range filtering is testable without faking time. */
const WEEK = 7 * 24 * 60 * 60_000;
const weeksAgo = (n: number) => new Date(Date.now() - n * WEEK);

const point = (n: number, over: Partial<WeekPoint> = {}): WeekPoint => ({
  weekStart: weeksAgo(n),
  bestE1rmKg: 200,
  bestSingleKg: 180,
  bestSingleReps: 3,
  bestReps: 8,
  bestRepsLoadKg: 140,
  ...over,
});

const set = (over: Partial<LiftSet> = {}): LiftSet => ({
  clientSetId: "st-1",
  loadKg: 180,
  reps: 3,
  rpe: 8,
  isWarmup: false,
  loggedAt: new Date("2026-09-11T10:00:00Z"),
  ...over,
});

const setup = () => {
  render(<LiftScreen exerciseId="dead" />);
  return { user: userEvent.setup() };
};

beforeEach(() => {
  vi.clearAllMocks();
  library.exercises = [{ id: "dead", name: "Deadlift", normalisedName: "deadlift", isGlobal: true }];
  data.weeks = [
    point(6, { bestE1rmKg: 205, bestSingleKg: 190, bestSingleReps: 2, bestReps: 10, bestRepsLoadKg: 130 }),
    point(3, { bestE1rmKg: 208, bestSingleKg: 200, bestSingleReps: 1, bestReps: 8, bestRepsLoadKg: 150 }),
    point(1, { bestE1rmKg: 212.5, bestSingleKg: 195, bestSingleReps: 2, bestReps: 12, bestRepsLoadKg: 140 }),
  ];
  data.sets = [set(), set({ clientSetId: "st-2", loadKg: 170, rpe: 7 })];
});

describe("with nothing logged", () => {
  it("says so rather than showing a chart of nothing", async () => {
    data.weeks = [];
    setup();
    expect(await screen.findByText("Nothing logged for this lift yet")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("the headline", () => {
  it("names the lift and its current estimate", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Deadlift" })).toBeInTheDocument();
    expect(screen.getByLabelText("Estimated 1RM")).toHaveTextContent("212.5 kg");
  });

  it("says how much it has moved across the range", async () => {
    setup();
    // 12w is the default, so all three weeks are in it: 205 to 212.5.
    expect(await screen.findByLabelText("Estimated 1RM")).toHaveTextContent("+7.5 (12w)");
  });

  it("re-measures when the range changes", async () => {
    const { user } = setup();
    await screen.findByLabelText("Estimated 1RM");
    // 8w still holds all three here, but 6m is a different label on the same
    // data -- what matters is that the label follows the button.
    await user.click(screen.getByRole("button", { name: "6m" }));
    expect(screen.getByLabelText("Estimated 1RM")).toHaveTextContent("(6m)");
  });
});

describe("the chart", () => {
  it("draws one line, named for a screen reader", async () => {
    setup();
    const chart = await screen.findByRole("img");
    expect(chart).toHaveAccessibleName(/Estimated 1RM for Deadlift/);
  });

  it("is hidden rather than emptied when there is too little to plot", async () => {
    // A two-point line turns a coincidence into a direction, on the screen
    // that exists to answer "is this going up".
    data.weeks = [point(3), point(1)];
    setup();
    expect(await screen.findByText("Not enough sessions to chart yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("offers the four ranges, with one selected", async () => {
    setup();
    const group = await screen.findByRole("group", { name: "Chart range" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "12w" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "8w" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("personal records", () => {
  it("shows the best of each", async () => {
    setup();
    const records = await screen.findByLabelText("Personal records");
    expect(records).toHaveTextContent("Heaviest single200 × 1");
    expect(records).toHaveTextContent("Best estimated212.5 kg");
    expect(records).toHaveTextContent("Most reps140 × 12");
  });

  it("stays all-time when the range narrows", async () => {
    // A record that changed when you tapped "8w" would not be a record.
    const { user } = setup();
    await screen.findByLabelText("Personal records");
    await user.click(screen.getByRole("button", { name: "8w" }));
    expect(screen.getByLabelText("Personal records")).toHaveTextContent("Heaviest single200 × 1");
  });
});

describe("recent sets", () => {
  it("lists them as they were logged", async () => {
    setup();
    const list = await screen.findByLabelText("Recent sets");
    expect(list).toHaveTextContent("180 × 3");
    expect(list).toHaveTextContent("RPE 8");
    expect(list).toHaveTextContent("170 × 3");
  });

  it("says so when a lift has only ever been warmed up with", async () => {
    // Warm-ups are excluded by the query, the same rule that keeps them out of
    // every total, record and rollup.
    data.sets = [];
    setup();
    expect(await screen.findByLabelText("Recent sets")).toHaveTextContent(
      "No working sets logged against this lift yet.",
    );
  });
});
