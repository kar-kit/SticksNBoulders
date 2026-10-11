import { render, screen, waitFor } from "@testing-library/react";
import { ProgramEditor } from "./program-editor";
import type { DayTree, ProgramTree, WeekTree } from "@/lib/programming/program";

/**
 * Where "Adjust program" lands the editor: the week and day a reviewed clip
 * was prescribed from, with the keyboard on its line. Kept apart from
 * program-editor.test.tsx, which covers the grid itself.
 */

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "ruairi", name: "R", email: "" }, coach: { isCoach: true, athleteIds: ["joey"] } },
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/athletes", () => ({ fetchAthleteNames: async () => [{ id: "joey", name: "Joey" }] }));
vi.mock("@/lib/exercises/library", () => ({
  fetchExerciseLibrary: async () => [{ id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true }],
}));

const store = vi.hoisted(() => ({ tree: null as unknown }));
vi.mock("@/lib/programming/program-store", () => ({
  fetchProgramTree: async () => store.tree,
  sendProgramOp: async () => ({ rowId: "new" }),
  fetchLoggedDayIds: async () => new Set(),
}));

const scrolled = vi.fn();
beforeAll(() => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = scrolled;
});

const day = (id: string, blockId: string, weekId: string, label: string, lineIds: string[]): DayTree => ({
  id,
  programId: "p1",
  blockId,
  weekId,
  position: 0,
  label,
  scheduledOn: null,
  notes: null,
  prescriptions: lineIds.map((lineId, position) => ({
    id: lineId,
    programId: "p1",
    weekId,
    dayId: id,
    exerciseId: "squat",
    position,
    setCount: 3,
    reps: 3,
    repMax: null,
    load: "@8",
    loadKind: "rpe",
    restSeconds: null,
    notes: null,
    updatedAt: "",
  })),
});

const week = (id: string, blockId: string, position: number, days: DayTree[]): WeekTree => ({
  id,
  programId: "p1",
  blockId,
  position,
  label: null,
  status: "published",
  notes: null,
  days,
});

const tree = (): ProgramTree => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Autumn block",
  status: "published",
  startOn: null,
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "",
  blocks: [
    { id: "b1", programId: "p1", position: 0, name: "Block 1", notes: null, weeks: [week("w1", "b1", 0, [day("d1", "b1", "w1", "Opener", ["l0"])])] },
    {
      id: "b2",
      programId: "p1",
      position: 1,
      name: "Block 2",
      notes: null,
      weeks: [
        week("w2", "b2", 0, []),
        week("w3", "b2", 1, [day("d9", "b2", "w3", "Heavy squat", ["l8", "l9"])]),
      ],
    },
  ],
});

beforeEach(() => {
  scrolled.mockClear();
  store.tree = tree();
});

it("opens on the traced week, in its own block, with the traced line focused", async () => {
  render(<ProgramEditor programId="p1" landing={{ weekId: "w3", dayId: "d9", lineId: "l9" }} />);
  const heavy = await screen.findByRole("region", { name: "Heavy squat" });
  expect(screen.getByRole("heading", { name: "Block 2 · Week 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Week 3, live" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("button", { name: "Week 1, live" })).not.toHaveAttribute("aria-current");
  // The scroll and focus run in a passive effect, which React's scheduler can
  // leave for a task after the commit that findByRole resolves on (it yields
  // once a 5 ms slice is spent, so a busy machine made this fail ~1 run in 25).
  // Wait for the landing rather than assume it. The exercise name in the row's
  // label arrives on a separate fetch, so wait for that too.
  await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
  expect(heavy.contains(document.activeElement)).toBe(true);
  await waitFor(() => expect(document.activeElement?.closest("tr")).toHaveAccessibleName("Heavy squat line 2: Squat"));
});

it("opens where it always did without a landing, or with one that is not in this program", async () => {
  const { unmount } = render(<ProgramEditor programId="p1" />);
  expect(await screen.findByRole("region", { name: "Opener" })).toBeInTheDocument();
  expect(scrolled).not.toHaveBeenCalled();
  unmount();

  render(<ProgramEditor programId="p1" landing={{ weekId: "elsewhere", dayId: "gone" }} />);
  expect(await screen.findByRole("region", { name: "Opener" })).toBeInTheDocument();
  expect(scrolled).not.toHaveBeenCalled();
});
