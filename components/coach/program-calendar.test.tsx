import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProgramEditor } from "./program-editor";
import type { DayTree, Prescription, ProgramTree, WeekTree } from "@/lib/programming/program";

/**
 * The editor's Calendar view: the program as dated weeks, RTS-style. Kept
 * apart from program-editor.test.tsx, which covers the week grid itself.
 */

const viewer = vi.hoisted(() => ({ id: "ruairi" }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: viewer.id, name: "R", email: "" },
      coach: { isCoach: true, athleteIds: ["joey"] },
    },
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/athletes", () => ({ fetchAthleteNames: async () => [{ id: "joey", name: "Joey" }] }));
vi.mock("@/lib/exercises/library", () => ({
  fetchExerciseLibrary: async () => [
    { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
    { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
    { id: "deadlift", name: "Deadlift", normalisedName: "deadlift", isGlobal: true },
    { id: "ohp", name: "Overhead Press", normalisedName: "overhead press", isGlobal: true },
  ],
}));
vi.mock("@/lib/strength/reference-max-store", () => ({
  fetchReferenceMaxes: async () => [],
  fetchEstimatedMaxes: async () => new Map(),
}));

const store = vi.hoisted(() => ({
  tree: null as unknown,
  send: vi.fn<(op: Record<string, unknown>) => Promise<{ rowId: string }>>(),
  logged: new Set<string>() as Set<string>,
}));
vi.mock("@/lib/programming/program-store", () => ({
  fetchProgramTree: async () => store.tree,
  sendProgramOp: (op: Record<string, unknown>) => store.send(op),
  fetchLoggedDayIds: async () => store.logged,
}));

const scrolled = vi.fn();
beforeAll(() => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = scrolled;
});

const line = (id: string, dayId: string, exerciseId: string, position: number): Prescription => ({
  id,
  programId: "p1",
  weekId: "w",
  dayId,
  exerciseId,
  position,
  setCount: 3,
  reps: 5,
  repMax: null,
  load: "@8",
  loadKind: "rpe",
  restSeconds: null,
  notes: null,
  updatedAt: "",
});

const day = (
  id: string,
  weekId: string,
  position: number,
  label: string | null,
  scheduledOn: string | null,
  exercises: string[],
): DayTree => ({
  id,
  programId: "p1",
  blockId: "b",
  weekId,
  position,
  label,
  scheduledOn,
  notes: null,
  prescriptions: exercises.map((ex, at) => line(`${id}-l${at}`, id, ex, at)),
});

const week = (
  id: string,
  blockId: string,
  position: number,
  status: "draft" | "published",
  days: DayTree[],
): WeekTree => ({
  id,
  programId: "p1",
  blockId,
  position,
  label: null,
  status,
  notes: null,
  days,
});

/**
 * Starts on a Wednesday, so week 1 runs Mon 5 Oct to Sun 11 Oct. Two blocks:
 * Accumulation (weeks 1 and 2) and Intensity (week 3, empty).
 */
const tree = (): ProgramTree => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Autumn block",
  status: "published",
  startOn: "2026-10-07",
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "",
  blocks: [
    {
      id: "b1",
      programId: "p1",
      position: 0,
      name: "Accumulation",
      notes: null,
      weeks: [
        week("w1", "b1", 0, "published", [
          // Five lines, four exercises: Squat twice (top set and backoffs).
          day("d1", "w1", 0, "Squat day", "2026-10-05", ["squat", "squat", "bench", "deadlift", "ohp"]),
          day("d2", "w1", 1, "Bench day", "2026-10-08", ["bench"]),
        ]),
        week("w2", "b1", 1, "draft", [day("d3", "w2", 0, null, "2026-10-13", [])]),
      ],
    },
    {
      id: "b2",
      programId: "p1",
      position: 1,
      name: "Intensity",
      notes: null,
      weeks: [week("w3", "b2", 0, "draft", [])],
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  viewer.id = "ruairi";
  store.tree = tree();
  store.logged = new Set(["d2"]);
  store.send.mockResolvedValue({ rowId: "new" });
  window.history.replaceState(null, "", "/coach/programs/p1?week=w1");
});

const calendar = async () => {
  render(<ProgramEditor programId="p1" view="calendar" />);
  return screen.findByRole("grid", { name: "Program calendar" });
};

describe("the Week | Calendar toggle", () => {
  it("switches views and keeps the choice in ?view=calendar, leaving the rest of the URL alone", async () => {
    const user = userEvent.setup();
    render(<ProgramEditor programId="p1" />);
    await screen.findByRole("region", { name: "Squat day" });
    const toggle = screen.getByRole("tablist", { name: "View" });
    expect(within(toggle).getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("grid", { name: "Program calendar" })).not.toBeInTheDocument();

    await user.click(within(toggle).getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByRole("grid", { name: "Program calendar" })).toBeInTheDocument();
    expect(within(toggle).getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "Squat day" })).not.toBeInTheDocument();
    const query = new URLSearchParams(window.location.search);
    expect(query.get("view")).toBe("calendar");
    expect(query.get("week")).toBe("w1");
    expect(window.location.pathname).toBe("/coach/programs/p1");

    await user.click(within(toggle).getByRole("tab", { name: "Week" }));
    expect(await screen.findByRole("region", { name: "Squat day" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has("view")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("week")).toBe("w1");
  });

  it("opens on the calendar when the URL asked for it", async () => {
    await calendar();
    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "Squat day" })).not.toBeInTheDocument();
    // The outline is the week view's navigation; the calendar rows replace it.
    expect(screen.queryByRole("navigation", { name: "Program outline" })).not.toBeInTheDocument();
  });

  it("is not offered on a template, which has no calendar", async () => {
    store.tree = { ...tree(), athleteId: null, startOn: null };
    render(<ProgramEditor programId="p1" view="calendar" />);
    expect(await screen.findByRole("region", { name: "Squat day" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "View" })).not.toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});

describe("the calendar grid", () => {
  it("has a Monday-first column per weekday and a row per program week, named with its block, week and state", async () => {
    const grid = await calendar();
    const headers = within(grid)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Week", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    // Live once the week and the program are; logged beats live (outline's rule).
    await waitFor(() =>
      expect(within(grid).getByRole("rowheader", { name: "Accumulation · Week 1, logged" })).toBeInTheDocument(),
    );
    expect(within(grid).getByRole("rowheader", { name: "Accumulation · Week 2, draft" })).toBeInTheDocument();
    expect(within(grid).getByRole("rowheader", { name: "Intensity · Week 3, draft" })).toBeInTheDocument();
  });

  it("separates the blocks, each with its dates", async () => {
    const grid = await calendar();
    const groups = within(grid)
      .getAllByRole("rowgroup")
      .filter((g) => g.tagName === "TBODY");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Accumulation", "Intensity"]);
    expect(within(groups[0]).getByRole("rowheader", { name: "Accumulation, 5–18 Oct" })).toBeInTheDocument();
    expect(within(groups[1]).getByRole("rowheader", { name: "Intensity, 19–25 Oct" })).toBeInTheDocument();
  });

  it("dates every cell from the start date's Monday, across weeks and blocks", async () => {
    const grid = await calendar();
    const rows = within(grid)
      .getAllByRole("row")
      .filter((r) => within(r).queryAllByRole("gridcell").length > 0);
    expect(
      within(rows[1])
        .getAllByRole("gridcell")
        .map((c) => c.getAttribute("data-date")),
    ).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(within(rows[2]).getAllByRole("gridcell")[6]).toHaveAttribute("data-date", "2026-10-25");
  });

  it("summarises a day: its title, the first three exercises, and how many more", async () => {
    const grid = await calendar();
    const squat = await within(grid).findByRole("button", {
      name: "Mon 5 Oct, Squat day: Squat, Bench Press, Deadlift, +1",
    });
    expect(within(squat).getByText("Squat day")).toBeInTheDocument();
    expect(within(squat).getByText("Deadlift")).toBeInTheDocument();
    expect(within(squat).queryByText("Overhead Press")).not.toBeInTheDocument();
    expect(within(squat).getByText("+1 more")).toBeInTheDocument();
    // Three or fewer: no "more".
    const bench = within(grid).getByRole("button", { name: /^Thu 8 Oct, Bench day: Bench Press/ });
    expect(within(bench).queryByText(/more/)).not.toBeInTheDocument();
  });

  it("marks a day an athlete has logged from, and names an unlabelled empty day by its place", async () => {
    const grid = await calendar();
    expect(
      await within(grid).findByRole("button", { name: "Thu 8 Oct, Bench day: Bench Press, logged" }),
    ).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: "Tue 13 Oct, Day 1: no exercises" })).toBeInTheDocument();
  });

  it("lists a day dated outside its week, or not dated, beside its week rather than dropping it", async () => {
    const t = tree();
    t.blocks[0].weeks[1].days.push(
      day("d4", "w2", 1, "Stray", "2026-11-30", ["squat"]),
      day("d5", "w2", 2, null, null, []),
    );
    store.tree = t;
    const grid = await calendar();
    const header = within(grid).getByRole("rowheader", { name: "Accumulation · Week 2, draft" });
    expect(await within(header).findByRole("button", { name: "Stray, 30 Nov, outside this week" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Day 3, no date" })).toBeInTheDocument();
  });

  it("walks the cells with the arrow keys, one tab stop for the grid", async () => {
    const user = userEvent.setup();
    const grid = await calendar();
    const squat = await within(grid).findByRole("button", { name: /^Mon 5 Oct, Squat day/ });
    const tabbable = [...grid.querySelectorAll<HTMLElement>("[data-cal-cell]")].filter((el) => el.tabIndex === 0);
    expect(tabbable).toEqual([squat]);
    squat.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toHaveAccessibleName("+ Day on Tue 6 Oct");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAccessibleName("Tue 13 Oct, Day 1: no exercises");
    await user.keyboard("{ArrowDown}{ArrowLeft}");
    expect(document.activeElement).toHaveAccessibleName("+ Day on Mon 19 Oct");
  });
});

describe("from the calendar to the week", () => {
  it("opens a day in Week view on its week, scrolled to it with the keyboard inside it", async () => {
    const user = userEvent.setup();
    const grid = await calendar();
    await user.click(await within(grid).findByRole("button", { name: /^Tue 13 Oct, Day 1/ }));
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Accumulation · Week 2" })).toBeInTheDocument();
    const opened = screen.getByRole("region", { name: "Day 1" });
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    expect(scrolled.mock.contexts[0]).toBe(opened);
    expect(opened.contains(document.activeElement)).toBe(true);
    expect(new URLSearchParams(window.location.search).has("view")).toBe(false);
  });

  it("puts the keyboard on the day's first line when it has one", async () => {
    const user = userEvent.setup();
    const grid = await calendar();
    await user.click(await within(grid).findByRole("button", { name: /^Mon 5 Oct, Squat day/ }));
    expect(screen.getByRole("heading", { name: "Accumulation · Week 1" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.closest("tr")).toHaveAccessibleName("Squat day line 1: Squat"));
  });
});

describe("+ Day from the calendar", () => {
  it("adds a day on the empty cell's weekday, dated from the start date, and stays on the calendar", async () => {
    const user = userEvent.setup();
    const grid = await calendar();
    await user.click(within(grid).getByRole("button", { name: "+ Day on Wed 14 Oct" }));
    expect(store.send).toHaveBeenCalledWith({ op: "addDay", weekId: "w2", scheduledOn: "2026-10-14" });
    await user.click(within(grid).getByRole("button", { name: "+ Day on Sun 25 Oct" }));
    expect(store.send).toHaveBeenLastCalledWith({ op: "addDay", weekId: "w3", scheduledOn: "2026-10-25" });
    expect(screen.getByRole("grid", { name: "Program calendar" })).toBeInTheDocument();
  });

  it("offers + Day only on empty cells", async () => {
    const grid = await calendar();
    expect(within(grid).queryByRole("button", { name: "+ Day on Mon 5 Oct" })).not.toBeInTheDocument();
    // 21 cells, 3 days.
    expect(within(grid).getAllByRole("button", { name: /^\+ Day on / })).toHaveLength(18);
  });

  it("dates from the days already dated when there is no start date, and still asks for one", async () => {
    store.tree = { ...tree(), startOn: null };
    const user = userEvent.setup();
    const grid = await calendar();
    expect(screen.getByText(/No start date yet\./)).toBeInTheDocument();
    await user.click(within(grid).getByRole("button", { name: "+ Day on Fri 23 Oct" }));
    expect(store.send).toHaveBeenCalledWith({ op: "addDay", weekId: "w3", scheduledOn: "2026-10-23" });
  });
});

describe("read-only and undated", () => {
  it("is read-only for anyone but the coach who wrote it: no + Day, but days still open", async () => {
    viewer.id = "louis";
    const user = userEvent.setup();
    const grid = await calendar();
    expect(within(grid).queryAllByRole("button", { name: /^\+ Day on / })).toHaveLength(0);
    expect(within(grid).getByRole("gridcell", { name: "Wed 7 Oct, no session" })).toBeInTheDocument();
    await user.click(await within(grid).findByRole("button", { name: /^Mon 5 Oct, Squat day/ }));
    expect(screen.getByRole("heading", { name: "Accumulation · Week 1" })).toBeInTheDocument();
    expect(store.send).not.toHaveBeenCalled();
  });

  it("with no start date and nothing dated, asks for one instead of drawing a calendar", async () => {
    const t = tree();
    t.startOn = null;
    for (const w of t.blocks.flatMap((b) => b.weeks)) for (const d of w.days) d.scheduledOn = null;
    store.tree = t;
    render(<ProgramEditor programId="p1" view="calendar" />);
    expect(await screen.findByText(/No start date yet\. Set one above/)).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});
