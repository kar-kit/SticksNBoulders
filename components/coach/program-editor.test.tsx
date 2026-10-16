import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProgramEditor } from "./program-editor";
import type { ProgramTree } from "@/lib/programming/program";

const viewer = vi.hoisted(() => ({ id: "ruairi" }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: viewer.id, name: "R", email: "r@e.com" }, coach: { isCoach: true, athleteIds: ["joey"] } },
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/athletes", () => ({ fetchAthleteNames: async () => [{ id: "joey", name: "Joey" }] }));
vi.mock("@/lib/exercises/library", () => ({
  fetchExerciseLibrary: async () => [
    { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
    { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
    { id: "deadlift", name: "Deadlift", normalisedName: "deadlift", isGlobal: true, videoDefault: true },
  ],
}));

const athleteMaxes = vi.hoisted(() => ({
  entries: [] as unknown[],
  fail: false,
  set: vi.fn<(input: Record<string, unknown>) => Promise<string>>(),
}));
vi.mock("@/lib/strength/reference-max-store", () => ({
  fetchReferenceMaxes: async () => {
    if (athleteMaxes.fail) throw new Error("offline");
    return athleteMaxes.entries;
  },
  fetchEstimatedMaxes: async () => new Map(),
  setReferenceMax: (input: Record<string, unknown>) => athleteMaxes.set(input),
}));

// The context drawer's reads: the athlete's sessions and sets, their clips and this coach's reviews.
const context = vi.hoisted(() => ({
  sessions: [{ id: "s1" }] as Array<{ id: string }>,
  sets: [] as unknown[],
  clips: [] as unknown[],
  reviewed: new Set<string>(),
}));
vi.mock("@/lib/logging/session-store", () => ({ fetchRecentSessions: async () => context.sessions }));
vi.mock("@/lib/logging/history-store", () => ({ fetchSetsForSessions: async () => context.sets }));
vi.mock("@/lib/review/queue-store", () => ({
  fetchClips: async () => context.clips,
  fetchReviewedSetIds: async () => context.reviewed,
}));
const squatMax = {
  id: "m1",
  exerciseId: "squat",
  kind: "training",
  valueKg: 200,
  effectiveFrom: "2026-09-01T00:00:00Z",
  recordedBy: "ruairi",
};

const store = vi.hoisted(() => ({
  tree: null as unknown,
  send: vi.fn<(op: Record<string, unknown>) => Promise<{ rowId: string }>>(),
  logged: new Set<string>() as Set<string> | "fail",
}));
vi.mock("@/lib/programming/program-store", () => ({
  fetchProgramTree: async () => store.tree,
  sendProgramOp: (op: Record<string, unknown>) => store.send(op),
  fetchLoggedDayIds: async () => {
    if (store.logged === "fail") throw new Error("offline");
    return store.logged;
  },
}));

const tree = (): ProgramTree => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Autumn block",
  status: "draft",
  startOn: "2026-10-05",
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "",
  blocks: [
    {
      id: "b1",
      programId: "p1",
      position: 0,
      name: "Block 1",
      notes: null,
      weeks: [
        {
          id: "w1",
          programId: "p1",
          blockId: "b1",
          position: 0,
          label: null,
          status: "draft",
          notes: null,
          days: [
            {
              id: "d1",
              programId: "p1",
              blockId: "b1",
              weekId: "w1",
              position: 0,
              label: "Squat day",
              scheduledOn: "2026-10-05",
              notes: null,
              prescriptions: [
                line("l1", "squat", 0, { setCount: 1, reps: 5, load: "@8", loadKind: "rpe" }),
                line("l2", "squat", 1, { setCount: 3, reps: 5, load: "75%", loadKind: "percent" }),
              ],
            },
          ],
        },
        { id: "w2", programId: "p1", blockId: "b1", position: 1, label: null, status: "draft", notes: null, days: [] },
      ],
    },
  ],
});

function line(id: string, exerciseId: string, position: number, over: Record<string, unknown>) {
  return {
    id,
    programId: "p1",
    weekId: "w1",
    dayId: "d1",
    exerciseId,
    position,
    setCount: 1,
    reps: null,
    repMax: null,
    load: null,
    loadKind: null,
    restSeconds: null,
    notes: null,
    updatedAt: "",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  viewer.id = "ruairi";
  athleteMaxes.entries = [squatMax];
  athleteMaxes.fail = false;
  athleteMaxes.set.mockResolvedValue("m-new");
  context.sets = [];
  context.clips = [];
  context.reviewed = new Set();
  window.localStorage.clear();
  store.tree = tree();
  store.logged = new Set();
  store.send.mockResolvedValue({ rowId: "new" });
});

const ready = async () => {
  render(<ProgramEditor programId="p1" />);
  return screen.findByRole("region", { name: "Squat day" });
};

describe("the Program Editor grid", () => {
  it("lists the weeks in the outline and lays out the day's lines with what each load cell landed as", async () => {
    const day = await ready();
    const outline = screen.getByRole("navigation", { name: "Program outline" });
    expect(within(outline).getAllByRole("button", { name: /^Week/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Week 1, draft",
      "Week 2, draft",
    ]);
    expect(await within(day).findByRole("row", { name: "Squat day line 1: Squat" })).toBeInTheDocument();
    expect(within(day).getByText("RPE 8 · athlete picks the weight")).toBeInTheDocument();
    expect(within(day).getByText("Percent · 75% of training max")).toBeInTheDocument();
  });

  it("saves a cell when it is left, sending only that field, and re-labels the load", async () => {
    const user = userEvent.setup();
    await ready();
    const load = screen.getByRole("textbox", { name: "Load, line 2" });
    await user.clear(load);
    await user.type(load, "75% @8");
    await user.tab();
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updatePrescription", prescriptionId: "l2", load: "75% @8" }),
    );
    expect(screen.getByText("Capped · 75% of training max, stop at RPE 8")).toBeInTheDocument();
  });

  it("says why a cell will not save, and sends nothing", async () => {
    const user = userEvent.setup();
    await ready();
    const sets = screen.getByRole("textbox", { name: "Sets, line 1" });
    await user.clear(sets);
    await user.type(sets, "0");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sets is a whole number, 1 to 50");
    expect(store.send).not.toHaveBeenCalled();
  });

  it("flags a line video-required from the keyboard, sending only that field", async () => {
    const user = userEvent.setup();
    await ready();
    const toggle = screen.getByRole("checkbox", { name: "Video required, line 2" });
    expect(toggle).not.toBeChecked();
    // Backoff (Order 21) sits between Note and Video.
    await user.click(screen.getByRole("textbox", { name: "Backoff, line 2" }));
    await user.keyboard("{ArrowRight}");
    expect(toggle).toHaveFocus();
    await user.keyboard(" ");
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updatePrescription", prescriptionId: "l2", videoRequired: true }),
    );
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Video required, line 2" })).toBeChecked());
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("checkbox", { name: "Video required, line 1" })).toHaveFocus();
  });

  it("saves a backoff rule in its canonical spelling and says what it does (Order 21)", async () => {
    const user = userEvent.setup();
    await ready();
    const cell = screen.getByRole("textbox", { name: "Backoff, line 1" });
    await user.click(cell);
    await user.keyboard("-10%x3");
    await user.tab();
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updatePrescription", prescriptionId: "l1", backoff: "3 x 90%" }),
    );
    expect(await screen.findByText("3 sets at 90% of today's top set")).toBeInTheDocument();
  });

  it("refuses a backoff it cannot execute on the cell, sending nothing", async () => {
    const user = userEvent.setup();
    await ready();
    store.send.mockClear();
    await user.click(screen.getByRole("textbox", { name: "Backoff, line 1" }));
    await user.keyboard("drop a bit");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Backoff is like");
    expect(store.send).not.toHaveBeenCalled();
  });

  it("puts a cell back when the server refuses it", async () => {
    store.send.mockRejectedValueOnce(new Error("not-allowed"));
    const user = userEvent.setup();
    await ready();
    const reps = screen.getByRole("textbox", { name: "Reps, line 1" });
    await user.clear(reps);
    await user.type(reps, "3");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("not-allowed");
    expect(screen.getByRole("textbox", { name: "Reps, line 1" })).toHaveValue("5");
  });

  it("moves down a column with the arrow keys and Enter, like a spreadsheet", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("textbox", { name: "Load, line 1" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("textbox", { name: "Load, line 2" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("textbox", { name: "Load, line 1" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Load, line 2" })).toHaveFocus();
  });

  it("adds a line by typing the exercise, never by hunting a list", async () => {
    const user = userEvent.setup();
    const day = await ready();
    await user.type(within(day).getByRole("combobox", { name: "Add exercise to Squat day" }), "bench");
    await user.click(await screen.findByRole("option", { name: "Bench Press" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "addPrescription", dayId: "d1", exerciseId: "bench", setCount: 1 }),
    );
  });

  it("pre-ticks video required on a new line for an exercise whose default is on", async () => {
    const user = userEvent.setup();
    const day = await ready();
    await user.type(within(day).getByRole("combobox", { name: "Add exercise to Squat day" }), "deadl");
    await user.click(await screen.findByRole("option", { name: "Deadlift" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({
        op: "addPrescription",
        dayId: "d1",
        exerciseId: "deadlift",
        setCount: 1,
        videoRequired: true,
      }),
    );
  });

  it("leaves video required out of a new line when the exercise has no default", async () => {
    const user = userEvent.setup();
    const day = await ready();
    await user.type(within(day).getByRole("combobox", { name: "Add exercise to Squat day" }), "bench");
    await user.click(await screen.findByRole("option", { name: "Bench Press" }));
    await waitFor(() => expect(store.send).toHaveBeenCalled());
    expect(store.send.mock.calls[0][0]).not.toHaveProperty("videoRequired", true);
  });

  it("does not touch an existing line's flag when its exercise is swapped for one with a default", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getAllByRole("button", { name: "Squat" })[1]);
    await user.type(screen.getByRole("combobox", { name: "Exercise for line 2" }), "deadl");
    await user.click(await screen.findByRole("option", { name: "Deadlift" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updatePrescription", prescriptionId: "l2", exerciseId: "deadlift" }),
    );
  });

  it("creates a variation the library lacks in the athlete's library, then uses it", async () => {
    store.send.mockImplementation(async (op) => ({ rowId: op.op === "createExercise" ? "ex-tempo" : "l3" }));
    const user = userEvent.setup();
    const day = await ready();
    await user.type(within(day).getByRole("combobox", { name: "Add exercise to Squat day" }), "Tempo Squat{Enter}");
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "addPrescription", dayId: "d1", exerciseId: "ex-tempo", setCount: 1 }),
    );
    expect(store.send).toHaveBeenCalledWith({ op: "createExercise", programId: "p1", name: "Tempo Squat" });
  });

  it("dates a new day after the week's last one", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "+ Day" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "addDay", weekId: "w1", scheduledOn: "2026-10-06" }),
    );
  });

  it("publishes every draft week from the program's ⋯, and asks before removing a day from the day's ⋯", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Program actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Publish all draft weeks" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "publishProgram", programId: "p1" }));

    await user.click(screen.getByRole("button", { name: "Squat day actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove Squat day" }));
    expect(store.send).not.toHaveBeenCalledWith({ op: "removeDay", dayId: "d1" });
    await user.click(screen.getByRole("button", { name: "Confirm remove squat day" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "removeDay", dayId: "d1" }));
  });

  it("releases one week at a time and pulls a published week back to draft", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Publish week 1" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "publishWeek", weekId: "w1" }));
    expect(store.send).not.toHaveBeenCalledWith({ op: "publishProgram", programId: "p1" });

    const published = tree();
    published.status = "published";
    published.blocks[0].weeks[0].status = "published";
    store.tree = published;
    await user.click(screen.getByRole("button", { name: /^Week 2/ }));
    await user.click(screen.getByRole("button", { name: "Publish week 2" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "publishWeek", weekId: "w2" }));

    await user.click(screen.getByRole("button", { name: "Week 1, live" }));
    await user.click(screen.getByRole("button", { name: "Unpublish week 1" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updateWeek", weekId: "w1", status: "draft" }),
    );
  });

  it("is read-only for anyone but the coach who wrote it", async () => {
    viewer.id = "louis";
    await ready();
    expect(screen.queryByRole("button", { name: "Program actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Publish|Unpublish) week/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Block" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^\+ Week/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wed" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Load, line 1" })).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove line/ })).not.toBeInTheDocument();
  });

  it("removes exactly the line whose × was pressed", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Remove line 2" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "removePrescription", prescriptionId: "l2" }));
    expect(store.send).toHaveBeenCalledTimes(1);
    expect(store.send).not.toHaveBeenCalledWith(expect.objectContaining({ prescriptionId: "l1" }));
  });

  it("says so when the program cannot be read, rather than showing an empty grid", async () => {
    store.tree = null;
    render(<ProgramEditor programId="nope" />);
    expect(await screen.findByText("No such program")).toBeInTheDocument();
  });
});

describe("a percentage of another lift (docs/reference-lift.md)", () => {
  it("takes `of <lift>` in the load cell as the reference, names it, and warns that its max is missing", async () => {
    const user = userEvent.setup();
    const day = await ready();
    // Squat has a training max, so the own-exercise 75% resolves: no warning.
    expect(within(day).queryByText(/No Squat training max/)).not.toBeInTheDocument();
    const load = screen.getByRole("textbox", { name: "Load, line 2" });
    await user.clear(load);
    await user.type(load, "75% of bench");
    await user.tab();
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updatePrescription", prescriptionId: "l2", referenceExerciseId: "bench" }),
    );
    expect(within(day).getByText("Percent · 75% of Bench Press (training max)")).toBeInTheDocument();
    // The stored load stays as the grammar knows it.
    expect(screen.getByRole("textbox", { name: "Load, line 2" })).toHaveValue("75%");
    expect(await within(day).findByText('No Bench Press training max for Joey · they see "75% of Bench Press"')).toBeInTheDocument();
  });

  it("gives a new line on the same exercise the reference used last in the program", async () => {
    const user = userEvent.setup();
    const t = tree();
    t.blocks[0].weeks[0].days[0].prescriptions[1].referenceExerciseId = "bench";
    store.tree = t;
    const day = await ready();
    await user.type(within(day).getByRole("combobox", { name: "Add exercise to Squat day" }), "squat");
    await user.click(await screen.findByRole("option", { name: "Squat" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({
        op: "addPrescription",
        dayId: "d1",
        exerciseId: "squat",
        setCount: 1,
        referenceExerciseId: "bench",
      }),
    );
  });

  it("warns on an own-exercise percentage with no max, as the resolver's comment always claimed", async () => {
    athleteMaxes.entries = [];
    const day = await ready();
    expect(await within(day).findByText('No Squat training max for Joey · they see "75%"')).toBeInTheDocument();
  });

  it("says nothing about maxes it could not read: unknown is not missing", async () => {
    athleteMaxes.fail = true;
    const day = await ready();
    await within(day).findByText("Percent · 75% of training max");
    expect(within(day).queryByText(/training max for/)).not.toBeInTheDocument();
  });
});

/** Block 1 as in `tree()`, plus Block 2 with one empty week, w3. */
const twoBlocks = (): ProgramTree => {
  const t = tree();
  t.blocks.push({
    id: "b2",
    programId: "p1",
    position: 1,
    name: "Peak",
    notes: null,
    weeks: [{ id: "w3", programId: "p1", blockId: "b2", position: 0, label: null, status: "draft", notes: null, days: [] }],
  });
  return t;
};

const outline = () => screen.getByRole("navigation", { name: "Program outline" });

describe("the outline", () => {
  it("shows each block with its dates from the start date, and each week with its dates", async () => {
    store.tree = twoBlocks();
    await ready();
    const b1 = within(outline()).getByRole("region", { name: "Block 1" });
    const b2 = within(outline()).getByRole("region", { name: "Peak" });
    expect(within(b1).getByText("5–18 Oct")).toBeInTheDocument();
    // The block's range, and its one week's.
    expect(within(b2).getAllByText("19–25 Oct")).toHaveLength(2);
    expect(within(b1).getByRole("button", { name: "Week 2, draft" })).toHaveTextContent("12–18 Oct");
    expect(within(b2).getByRole("button", { name: "Week 3, draft" })).toBeInTheDocument();
  });

  it("shows the selected week in the main pane, titled with its block and dates", async () => {
    store.tree = twoBlocks();
    const user = userEvent.setup();
    await ready();
    expect(screen.getByRole("heading", { name: "Block 1 · Week 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week 1, draft" })).toHaveAttribute("aria-current", "true");

    await user.click(screen.getByRole("button", { name: "Week 3, draft" }));
    expect(screen.getByRole("heading", { name: "Peak · Week 3" })).toBeInTheDocument();
    expect(screen.getByText("19–25 Oct · Draft")).toBeInTheDocument();
    expect(screen.getByText("No days in this week yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Squat day" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week 3, draft" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Week 1, draft" })).not.toHaveAttribute("aria-current");
  });

  it("walks every week in the program with the arrow keys, one tab stop for the lot", async () => {
    store.tree = twoBlocks();
    const user = userEvent.setup();
    await ready();
    const first = screen.getByRole("button", { name: "Week 1, draft" });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Week 2, draft" })).toHaveAttribute("tabindex", "-1");
    first.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("button", { name: "Week 3, draft" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Week 3, draft" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(screen.getByRole("heading", { name: "Block 1 · Week 2" })).toBeInTheDocument();
  });

  it("marks a week live only once its program is, and logged once a session was started from it", async () => {
    const t = twoBlocks();
    t.status = "published";
    t.blocks[0].weeks[0].status = "published";
    t.blocks[0].weeks[1].status = "published";
    t.blocks[0].weeks[1].days = [{ ...t.blocks[0].weeks[0].days[0], id: "d2", weekId: "w2", label: "Bench day", prescriptions: [] }];
    t.blocks[0].weeks[0].days[0].scheduledOn = "2026-10-05";
    store.tree = t;
    store.logged = new Set(["d1"]);
    const day = await ready();
    expect(await screen.findByRole("button", { name: "Week 1, logged" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week 2, live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week 3, draft" })).toBeInTheDocument();
    expect(within(day).getByText("Logged")).toBeInTheDocument();
  });

  it("never marks a week logged when the sessions could not be read", async () => {
    const t = tree();
    t.status = "published";
    t.blocks[0].weeks[0].status = "published";
    store.tree = t;
    store.logged = "fail";
    await ready();
    expect(screen.getByRole("button", { name: "Week 1, live" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /logged$/ })).not.toBeInTheDocument();
  });

  it("names a block from its ⋯ with a phase, renames it inline, and removes it only once confirmed", async () => {
    store.tree = twoBlocks();
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Block 1 actions" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Call it Accumulation",
      "Call it Intensity",
      "Call it Peak",
      "Call it Taper",
      "Call it Deload",
      "Remove Block 1",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Call it Intensity" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "updateBlock", blockId: "b1", name: "Intensity" }));

    // The phase it already is is not offered again.
    await user.click(screen.getByRole("button", { name: "Peak actions" }));
    expect(screen.queryByRole("menuitem", { name: "Call it Peak" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const name = screen.getByRole("textbox", { name: "Peak name" });
    await user.clear(name);
    await user.type(name, "Comp peak{Enter}");
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "updateBlock", blockId: "b2", name: "Comp peak" }));

    await user.click(screen.getByRole("button", { name: "Peak actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove Peak" }));
    expect(store.send).not.toHaveBeenCalledWith({ op: "removeBlock", blockId: "b2" });
    await user.click(screen.getByRole("button", { name: "Confirm remove peak" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "removeBlock", blockId: "b2" }));
  });
});

describe("+ Week and + Block", () => {
  it("+ Week repeats the block's LAST week, not the one on screen, and opens the copy", async () => {
    store.send.mockResolvedValue({ rowId: "w9" });
    const user = userEvent.setup();
    await ready();
    expect(screen.getByRole("heading", { name: "Block 1 · Week 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Week in Block 1" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "duplicateWeek", weekId: "w2" }));
    expect(store.send).toHaveBeenCalledTimes(1);
  });

  it("+ Week in an empty block adds a blank week", async () => {
    const t = twoBlocks();
    t.blocks[1].weeks = [];
    store.tree = t;
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "+ Week in Peak" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "addWeek", blockId: "b2" }));
    expect(store.send).not.toHaveBeenCalledWith(expect.objectContaining({ op: "duplicateWeek" }));
  });

  it("+ Block starts with a copy of the last week before it, a week later, line for line", async () => {
    const t = tree();
    // The last week of the last block is the source: w2, given a day here.
    t.blocks[0].weeks[1].days = [
      {
        ...t.blocks[0].weeks[0].days[0],
        id: "d2",
        weekId: "w2",
        label: "Heavy",
        scheduledOn: "2026-10-14",
        notes: "belt",
        prescriptions: [
          { ...t.blocks[0].weeks[0].days[0].prescriptions[1], id: "l5", dayId: "d2", weekId: "w2", backoff: "3 x 90%" },
        ],
      },
    ];
    store.tree = t;
    const ids: Record<string, string> = { addBlock: "b9", addWeek: "w9", addDay: "d9", addPrescription: "l9" };
    store.send.mockImplementation(async (op) => ({ rowId: ids[op.op as string] ?? "x" }));
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "+ Block" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledTimes(4));
    expect(store.send.mock.calls.map((c) => c[0])).toEqual([
      { op: "addBlock", programId: "p1", name: "Block 2" },
      { op: "addWeek", blockId: "b9" },
      { op: "addDay", weekId: "w9", label: "Heavy", scheduledOn: "2026-10-21", notes: "belt" },
      {
        op: "addPrescription",
        dayId: "d9",
        exerciseId: "squat",
        setCount: 3,
        reps: 5,
        repMax: null,
        load: "75%",
        restSeconds: null,
        notes: null,
        backoff: "3 x 90%",
        videoRequired: false,
        referenceExerciseId: null,
      },
    ]);
  });

  it("+ Block with nothing before it to copy adds a block with one blank week", async () => {
    const t = tree();
    t.blocks[0].weeks = [];
    store.tree = t;
    store.send.mockImplementation(async (op) => ({ rowId: op.op === "addBlock" ? "b9" : "w9" }));
    const user = userEvent.setup();
    render(<ProgramEditor programId="p1" />);
    await user.click(await screen.findByRole("button", { name: "+ Block" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledTimes(2));
    expect(store.send.mock.calls.map((c) => c[0])).toEqual([
      { op: "addBlock", programId: "p1", name: "Block 2" },
      { op: "addWeek", blockId: "b9" },
    ]);
  });

  it("says so when the copy stops halfway, rather than failing quietly", async () => {
    const t = tree();
    t.blocks[0].weeks[1].days = [{ ...t.blocks[0].weeks[0].days[0], id: "d2", weekId: "w2", label: "Heavy" }];
    store.tree = t;
    store.send.mockImplementation(async (op) => {
      if (op.op === "addDay") throw new Error("not-allowed");
      return { rowId: op.op === "addBlock" ? "b9" : "w9" };
    });
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "+ Block" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not-allowed");
  });
});

describe("one publish at a time", () => {
  it("offers exactly one publish button, the week's, primary; the program-wide one is in the ⋯", async () => {
    await ready();
    expect(screen.getAllByRole("button", { name: /publish/i }).map((b) => b.textContent)).toEqual(["Publish week 1"]);
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("swaps to a secondary Unpublish once the week is live, with no Publish beside it", async () => {
    const t = tree();
    t.status = "published";
    t.blocks[0].weeks[0].status = "published";
    store.tree = t;
    await ready();
    expect(screen.getAllByRole("button", { name: /publish/i }).map((b) => b.textContent)).toEqual(["Unpublish week 1"]);
  });

  it("treats a published week under a draft program as not live yet: Publish takes both live", async () => {
    const t = tree();
    t.blocks[0].weeks[0].status = "published";
    store.tree = t;
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Publish week 1" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "publishWeek", weekId: "w1" }));
  });

  it("drops Publish all from the ⋯ when nothing is left in draft", async () => {
    const t = tree();
    t.status = "published";
    t.blocks[0].weeks.forEach((w) => (w.status = "published"));
    store.tree = t;
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Program actions" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Copy to…"]);
  });

  it("opens Copy to… from the program's ⋯ and closes it again", async () => {
    const user = userEvent.setup();
    await ready();
    expect(screen.queryByRole("form", { name: "Copy program" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Program actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy to…" }));
    const form = screen.getByRole("form", { name: "Copy program" });
    await user.click(within(form).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("form", { name: "Copy program" })).not.toBeInTheDocument();
  });

  it("removes a week from its ⋯ only once confirmed", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Week 1 actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove week 1" }));
    expect(store.send).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm remove week 1" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "removeWeek", weekId: "w1" }));
  });
});

describe("dates from the start date", () => {
  it("shows the day's weekday as the pressed chip and its date, with no date picker", async () => {
    const day = await ready();
    const chips = within(day).getByRole("group", { name: "Squat day weekday" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(within(chips).getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(within(chips).getByRole("button", { name: "Wed" })).toHaveAttribute("aria-pressed", "false");
    expect(within(day).getByText("Mon 5 Oct")).toBeInTheDocument();
    expect(within(day).queryByLabelText(/date$/)).not.toBeInTheDocument();
  });

  it("stores start + week + weekday when a chip is picked", async () => {
    const t = tree();
    t.blocks[0].weeks[1].days = [{ ...t.blocks[0].weeks[0].days[0], id: "d2", weekId: "w2", label: "Bench day", scheduledOn: "2026-10-12", prescriptions: [] }];
    store.tree = t;
    const user = userEvent.setup();
    const day = await ready();
    await user.click(within(day).getByRole("button", { name: "Wed" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "updateDay", dayId: "d1", scheduledOn: "2026-10-07" }));

    await user.click(screen.getByRole("button", { name: /^Week 2/ }));
    const bench = screen.getByRole("region", { name: "Bench day" });
    await user.click(within(bench).getByRole("button", { name: "Sat" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "updateDay", dayId: "d2", scheduledOn: "2026-10-17" }));
  });

  it("sends nothing when the chip already pressed is pressed again", async () => {
    const user = userEvent.setup();
    const day = await ready();
    await user.click(within(day).getByRole("button", { name: "Mon" }));
    expect(store.send).not.toHaveBeenCalled();
  });

  it("shows a day dated outside its week where it is, presses no chip, and moves it only when asked", async () => {
    const t = tree();
    t.blocks[0].weeks[0].days[0].scheduledOn = "2026-10-20";
    store.tree = t;
    const user = userEvent.setup();
    const day = await ready();
    expect(within(day).getByText("Tue 20 Oct · outside this week")).toBeInTheDocument();
    expect(within(day).queryByRole("button", { pressed: true })).not.toBeInTheDocument();
    expect(store.send).not.toHaveBeenCalled();
    await user.click(within(day).getByRole("button", { name: "Tue" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "updateDay", dayId: "d1", scheduledOn: "2026-10-06" }));
  });

  it("with no start date and nothing dated, asks for one and holds the chips", async () => {
    const t = tree();
    t.startOn = null;
    t.blocks[0].weeks[0].days[0].scheduledOn = null;
    store.tree = t;
    const day = await ready();
    expect(screen.getByText(/No start date yet/)).toBeInTheDocument();
    expect(within(day).getByRole("button", { name: "Mon" })).toBeDisabled();
    expect(within(day).getByText("Set a start date to date it")).toBeInTheDocument();
  });

  it("with no start date, counts from the days already dated, so the chips still work", async () => {
    const t = tree();
    t.startOn = null;
    store.tree = t;
    const user = userEvent.setup();
    const day = await ready();
    expect(screen.getByText(/count from the days already dated/)).toBeInTheDocument();
    await user.click(within(day).getByRole("button", { name: "Thu" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "updateDay", dayId: "d1", scheduledOn: "2026-10-08" }));
  });

  it("moving the start date moves the days with it, keeping their weekdays", async () => {
    const user = userEvent.setup();
    await ready();
    const start = screen.getByLabelText("Start date");
    await user.clear(start);
    await user.type(start, "2026-10-14");
    await user.tab();
    await waitFor(() => expect(store.send).toHaveBeenCalledTimes(2));
    expect(store.send.mock.calls.map((c) => c[0])).toEqual([
      { op: "updateProgram", programId: "p1", startOn: "2026-10-14" },
      { op: "updateDay", dayId: "d1", scheduledOn: "2026-10-12" },
    ]);
  });

  it("never moves a day an athlete has logged from when the start date moves", async () => {
    store.logged = new Set(["d1"]);
    const user = userEvent.setup();
    await ready();
    await screen.findByRole("button", { name: "Week 1, logged" });
    const start = screen.getByLabelText("Start date");
    await user.clear(start);
    await user.type(start, "2026-10-14");
    await user.tab();
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "updateProgram", programId: "p1", startOn: "2026-10-14" }));
    expect(store.send).toHaveBeenCalledTimes(1);
  });

  it("moves no day when it could not tell which were logged, and says so", async () => {
    store.logged = "fail";
    const user = userEvent.setup();
    await ready();
    const start = screen.getByLabelText("Start date");
    await user.clear(start);
    await user.type(start, "2026-10-14");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("The days kept their dates");
    expect(store.send).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------
 * docs/program-layout.md: kilos, shorthand, the keyboard, progression, context
 * ---------------------------------------------------------------------- */

describe("the kilos under every percentage", () => {
  it("shows what the percentage resolves to and the max behind it", async () => {
    const day = await ready();
    expect(await within(day).findByText("→ 150 kg · Squat training max 200, set 1 Sep")).toBeInTheDocument();
  });

  it("adds a missing max from beside the cell, then prices the line off it", async () => {
    athleteMaxes.entries = [];
    athleteMaxes.set.mockImplementation(async (input) => {
      athleteMaxes.entries = [{ ...squatMax, valueKg: input.valueKg as number }];
      return "m-new";
    });
    const user = userEvent.setup();
    const day = await ready();
    expect(await within(day).findByText('No Squat training max for Joey · they see "75%"')).toBeInTheDocument();
    await user.click(within(day).getByRole("button", { name: "Add one" }));
    await user.type(within(day).getByRole("textbox", { name: "Squat training max, kg" }), "180{Enter}");
    expect(athleteMaxes.set).toHaveBeenCalledWith({ athleteId: "joey", exerciseId: "squat", kind: "training", valueKg: 180 });
    expect(await within(day).findByText("→ 135 kg · Squat training max 180, set 1 Sep")).toBeInTheDocument();
    expect(store.send).not.toHaveBeenCalled();
  });

  it("says the maxes could not be read rather than showing nothing", async () => {
    athleteMaxes.fail = true;
    const day = await ready();
    expect(await within(day).findByText("Could not read Joey's maxes · kilos unknown")).toBeInTheDocument();
  });
});

/** Week 1 with a second day under the squat day. */
const twoDays = (): ProgramTree => {
  const t = tree();
  t.blocks[0].weeks[0].days.push({
    id: "d2",
    programId: "p1",
    blockId: "b1",
    weekId: "w1",
    position: 1,
    label: "Bench day",
    scheduledOn: "2026-10-07",
    notes: null,
    prescriptions: [{ ...line("l3", "bench", 0, { setCount: 4, reps: 6, load: "70%", loadKind: "percent" }), dayId: "d2" }],
  });
  return t;
};

describe("keyboard-first entry", () => {
  it("fills sets, reps and load from 5x3 @8 typed into the sets cell, in one write", async () => {
    const user = userEvent.setup();
    await ready();
    const sets = screen.getByRole("textbox", { name: "Sets, line 2" });
    await user.clear(sets);
    await user.type(sets, "5x3 @8");
    await user.tab();
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({
        op: "updatePrescription",
        prescriptionId: "l2",
        setCount: 5,
        reps: 3,
        repMax: null,
        load: "@8",
      }),
    );
    expect(store.send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Sets, line 2" })).toHaveValue("5");
    expect(screen.getByRole("textbox", { name: "Load, line 2" })).toHaveValue("@8");
  });

  it("keeps the keyboard in the cell Tab moved to, even when the save changes that cell", async () => {
    const user = userEvent.setup();
    await ready();
    const sets = screen.getByRole("textbox", { name: "Sets, line 2" });
    await user.clear(sets);
    await user.type(sets, "5x3");
    await user.tab();
    const reps = screen.getByRole("textbox", { name: "Reps, line 2" });
    await waitFor(() => expect(reps).toHaveValue("3"));
    expect(reps).toHaveFocus();
    await user.keyboard("{Backspace}4");
    await user.tab();
    await waitFor(() =>
      expect(store.send).toHaveBeenLastCalledWith({ op: "updatePrescription", prescriptionId: "l2", reps: 4, repMax: null }),
    );
  });

  it("goes from a day's last row to its Add exercise field on Enter, to type the next line", async () => {
    const user = userEvent.setup();
    const day = await ready();
    await user.click(screen.getByRole("textbox", { name: "Load, line 2" }));
    await user.keyboard("{Enter}");
    expect(within(day).getByRole("combobox", { name: "Add exercise to Squat day" })).toHaveFocus();
  });

  it("carries Up and Down on into the day card above or below, in the same column", async () => {
    store.tree = twoDays();
    const user = userEvent.setup();
    await ready();
    const bench = await screen.findByRole("region", { name: "Bench day" });
    await user.click(screen.getAllByRole("textbox", { name: "Reps, line 2" })[0]);
    await user.keyboard("{ArrowDown}");
    expect(within(bench).getByRole("textbox", { name: "Reps, line 1" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(within(screen.getByRole("region", { name: "Squat day" })).getByRole("textbox", { name: "Reps, line 2" })).toHaveFocus();
  });

  it("backs out of an exercise swap with Escape, onto the exercise cell, changing nothing", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getAllByRole("button", { name: "Squat" })[1]);
    const field = screen.getByRole("combobox", { name: "Exercise for line 2" });
    await user.type(field, "dead");
    await user.keyboard("{Escape}{Escape}");
    expect(screen.queryByRole("combobox", { name: "Exercise for line 2" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Squat" })[1]).toHaveFocus());
    expect(store.send).not.toHaveBeenCalled();
  });
});

/** Two weeks of the squat day: week 2 has the top set and a 77.5% backoff, and no bench line. */
const twoWeeks = (): ProgramTree => {
  const t = tree();
  const [w1, w2] = t.blocks[0].weeks;
  w1.days[0].prescriptions.push(line("l4", "bench", 2, { setCount: 4, reps: 6, load: "70%", loadKind: "percent" }));
  w2.days = [
    {
      ...w1.days[0],
      id: "d2",
      weekId: "w2",
      label: null,
      scheduledOn: "2026-10-12",
      prescriptions: [
        { ...line("l1b", "squat", 0, { setCount: 1, reps: 5, load: "@8", loadKind: "rpe" }), weekId: "w2", dayId: "d2" },
        { ...line("l2b", "squat", 1, { setCount: 3, reps: 5, load: "77.5%", loadKind: "percent" }), weekId: "w2", dayId: "d2" },
      ],
    },
  ];
  return t;
};

describe("the progression view", () => {
  const progression = async () => {
    store.tree = twoWeeks();
    render(<ProgramEditor programId="p1" view="progression" />);
    return screen.findByRole("table", { name: "Block 1 progression" });
  };

  it("lays the block out as slots by week, each cell the line in shorthand with its kilos", async () => {
    const grid = await progression();
    expect(screen.getByRole("tab", { name: "Progression" })).toHaveAttribute("aria-selected", "true");
    expect(within(grid).getByRole("textbox", { name: "Squat day · Squat (2nd), Week 1" })).toHaveValue("3x5 75%");
    expect(within(grid).getByRole("textbox", { name: "Squat day · Squat (2nd), Week 2" })).toHaveValue("3x5 77.5%");
    expect(within(grid).getByRole("textbox", { name: "Squat day · Squat, Week 2" })).toHaveValue("1x5 @8");
    // 77.5% of 200 is 155: the compact line shows the kilos, the title the rest.
    expect(await within(grid).findByText("→ 155 kg")).toHaveAttribute("title", "→ 155 kg · Squat training max 200, set 1 Sep");
  });

  it("edits a week's load in place with one number, sending only the load", async () => {
    const user = userEvent.setup();
    const grid = await progression();
    const cell = within(grid).getByRole("textbox", { name: "Squat day · Squat (2nd), Week 2" });
    await user.clear(cell);
    await user.type(cell, "80%");
    await user.tab();
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updatePrescription", prescriptionId: "l2b", load: "80%" }),
    );
    expect(within(grid).getByRole("textbox", { name: "Squat day · Squat (2nd), Week 2" })).toHaveValue("3x5 80%");
  });

  it("adds the missing line to that week's day by typing into its empty cell", async () => {
    const user = userEvent.setup();
    const grid = await progression();
    const cell = within(grid).getByRole("textbox", { name: "Squat day · Bench Press, Week 2" });
    expect(cell).toHaveValue("");
    await user.type(cell, "4x6 72.5%");
    await user.tab();
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({
        op: "addPrescription",
        dayId: "d2",
        exerciseId: "bench",
        setCount: 4,
        reps: 6,
        repMax: null,
        load: "72.5%",
      }),
    );
  });

  it("walks the grid with the arrow keys: along a slot's weeks, and down through the slots", async () => {
    const user = userEvent.setup();
    const grid = await progression();
    await user.click(within(grid).getByRole("textbox", { name: "Squat day · Squat, Week 1" }));
    await user.keyboard("{End}{ArrowRight}");
    expect(within(grid).getByRole("textbox", { name: "Squat day · Squat, Week 2" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(grid).getByRole("textbox", { name: "Squat day · Squat (2nd), Week 2" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(within(grid).getByRole("textbox", { name: "Squat day · Bench Press, Week 2" })).toHaveFocus();
  });

  it("opens a week in the week view from its column heading", async () => {
    const user = userEvent.setup();
    await progression();
    await user.click(screen.getByRole("button", { name: "Open Week 2 in the week view" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Block 1 · Week 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("the context drawer", () => {
  it("opens beside the week with their last logged week and the clips this coach has not cleared", async () => {
    context.sets = [
      { exerciseId: "squat", sessionId: "s1", setIndex: 0, loadKg: 180, reps: 3, rpe: 8, isWarmup: false, loggedAt: new Date("2026-10-06T10:00:00") },
      { exerciseId: "squat", sessionId: "s1", setIndex: 1, loadKg: 150, reps: 5, rpe: 7, isWarmup: false, loggedAt: new Date("2026-10-06T10:10:00") },
      { exerciseId: "squat", sessionId: "s1", setIndex: 2, loadKg: 150, reps: 5, rpe: 7, isWarmup: false, loggedAt: new Date("2026-10-06T10:20:00") },
    ];
    context.clips = [
      { id: "c1", athleteId: "joey", exerciseId: "squat", sessionId: "s1", setIndex: 0, loadKg: 180, reps: 3, rpe: 8, e1rmKg: null, loggedAt: "2026-10-06T10:00:00Z", videoFileId: "f1", notes: null },
      { id: "c2", athleteId: "joey", exerciseId: "squat", sessionId: "s1", setIndex: 1, loadKg: 150, reps: 5, rpe: 7, e1rmKg: null, loggedAt: "2026-10-06T10:10:00Z", videoFileId: "f2", notes: null },
    ];
    context.reviewed = new Set(["c1"]);
    const user = userEvent.setup();
    await ready();
    expect(screen.queryByRole("complementary", { name: "Context" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Context" }));
    const drawer = await screen.findByRole("complementary", { name: "Context" });
    expect(await within(drawer).findByText("180 × 3 @8, 150 × 5 @7 ×2")).toBeInTheDocument();
    const videos = within(drawer).getByRole("region", { name: "Videos waiting" });
    expect(within(videos).getByText("Videos waiting · 1")).toBeInTheDocument();
    expect(within(videos).getAllByRole("listitem")).toHaveLength(1);
    expect(window.localStorage.getItem("snb.editor.context")).toBe("open");
    expect(store.send).not.toHaveBeenCalled();
  });

  it("says when their sessions did not load, rather than showing an empty week", async () => {
    context.sessions = null as unknown as Array<{ id: string }>;
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Context" }));
    expect(await screen.findByText("Their sessions did not load. Nothing here is missing; it is unknown.")).toBeInTheDocument();
    context.sessions = [{ id: "s1" }];
  });
});

describe("duplicate with a bump", () => {
  it("previews where the copy lands and what changes, then writes the copy and steps its lines", async () => {
    const copy = tree().blocks[0].weeks[0];
    const copied = {
      ...copy,
      id: "w9",
      position: 2,
      days: copy.days.map((d) => ({ ...d, id: "d9", weekId: "w9", prescriptions: d.prescriptions.map((l) => ({ ...l, id: `${l.id}-9`, weekId: "w9", dayId: "d9" })) })),
    };
    store.send.mockImplementation(async (op) => {
      if (op.op === "duplicateWeek") {
        const t = tree();
        t.blocks[0].weeks.push(copied);
        store.tree = t;
        return { rowId: "w9" };
      }
      return { rowId: "x" };
    });
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Week 1 actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplicate with a bump…" }));
    const form = screen.getByRole("region", { name: "Duplicate with a bump" });
    expect(within(form).getByText("Lands as Week 3, 19–25 Oct, at the end of Block 1.")).toBeInTheDocument();
    await user.type(within(form).getByRole("textbox", { name: "+ %" }), "2.5");
    await user.type(within(form).getByRole("textbox", { name: "+ RPE" }), "0.5");
    const changes = within(form).getByRole("list", { name: "Lines that change" });
    expect(within(changes).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Squat: @8 → @8.5", "Squat: 75% → 77.5%"]);
    expect(store.send).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(store.send.mock.calls.map((c) => c[0])).toEqual([
        { op: "duplicateWeek", weekId: "w1" },
        { op: "updatePrescription", prescriptionId: "l1-9", load: "@8.5" },
        { op: "updatePrescription", prescriptionId: "l2-9", load: "77.5%" },
      ]),
    );
    expect(await screen.findByRole("heading", { level: 2, name: "Block 1 · Week 3" })).toBeInTheDocument();
  });

  it("refuses a step it cannot apply, and writes nothing", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Week 1 actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplicate with a bump…" }));
    const form = screen.getByRole("region", { name: "Duplicate with a bump" });
    await user.type(within(form).getByRole("textbox", { name: "+ RPE" }), "0.3{Enter}");
    expect(within(form).getByRole("alert")).toHaveTextContent("RPE moves in half points, like 0.5");
    expect(store.send).not.toHaveBeenCalled();
  });
});

/*
 * Motion that changes what is on screen and when (docs/coach-motion.md). The
 * animations themselves are CSS and are proven in a browser by
 * scripts/e2e-coach-motion.mts; these pin the behaviour around them.
 */
describe("motion", () => {
  const rowOf = (lineId: string) => document.querySelector<HTMLTableRowElement>(`tr[data-line="${lineId}"]`);
  const cellOf = (input: HTMLElement) => input.closest("td")!;
  /**
   * An animation ending. jsdom has no AnimationEvent, so React listens for the
   * prefixed name there; a browser sends the plain one. Both, so the test
   * reaches React's handler and native listeners alike.
   */
  const ended = (el: Element) =>
    act(() => {
      fireEvent.animationEnd(el);
      el.dispatchEvent(new Event("webkitAnimationEnd", { bubbles: true }));
    });

  it("takes a removed line off the grid when its fade ends, before the server has answered", async () => {
    let answer: (value: { rowId: string }) => void = () => {};
    store.send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    const day = await ready();
    await user.click(within(day).getByRole("button", { name: "Remove line 2" }));

    // Fading: still in the document, already out of the accessibility tree.
    const row = rowOf("l2")!;
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-hidden", "true");
    expect(within(day).queryByRole("row", { name: /line 2/ })).not.toBeInTheDocument();

    ended(row);
    expect(rowOf("l2")).toBeNull();
    expect(rowOf("l1")).not.toBeNull();

    const without = tree();
    without.blocks[0].weeks[0].days[0].prescriptions.pop();
    store.tree = without;
    answer({ rowId: "l2" });
    await waitFor(() => expect(within(day).queryByRole("button", { name: "Remove line 2" })).not.toBeInTheDocument());
  });

  it("puts a removed line back where it was when the server refuses", async () => {
    store.send.mockRejectedValueOnce(new Error("not-allowed"));
    const user = userEvent.setup();
    const day = await ready();
    await user.click(within(day).getByRole("button", { name: "Remove line 2" }));
    ended(rowOf("l2")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("not-allowed");
    expect(within(day).getByRole("row", { name: "Squat day line 2: Squat" })).not.toHaveAttribute("aria-hidden");
  });

  it("tints a cell saved once the server takes it, and refused when it cannot be saved", async () => {
    const user = userEvent.setup();
    await ready();
    const reps = screen.getByRole("textbox", { name: "Reps, line 1" });
    await user.clear(reps);
    await user.type(reps, "3");
    await user.tab();
    await waitFor(() => expect(cellOf(reps)).toHaveAttribute("data-flash", "saved"));

    const sets = screen.getByRole("textbox", { name: "Sets, line 2" });
    await user.clear(sets);
    await user.type(sets, "0");
    await user.tab();
    expect(cellOf(sets)).toHaveAttribute("data-flash", "failed");
  });

  it("tints a cell refused when the server turns the save down", async () => {
    store.send.mockRejectedValueOnce(new Error("not-allowed"));
    const user = userEvent.setup();
    await ready();
    const reps = screen.getByRole("textbox", { name: "Reps, line 1" });
    await user.clear(reps);
    await user.type(reps, "3");
    await user.tab();
    await waitFor(() => expect(cellOf(reps)).toHaveAttribute("data-flash", "failed"));
  });

  it("marks only a line added since the editor opened to arrive, not the ones it opened with", async () => {
    const user = userEvent.setup();
    const day = await ready();
    const added = tree();
    added.blocks[0].weeks[0].days[0].prescriptions.push(line("l3", "bench", 2, { setCount: 1 }));
    store.tree = added;
    store.send.mockResolvedValueOnce({ rowId: "l3" });
    await user.type(within(day).getByRole("combobox", { name: "Add exercise to Squat day" }), "bench");
    await user.click(await screen.findByRole("option", { name: "Bench Press" }));
    await waitFor(() => expect(rowOf("l3")).not.toBeNull());
    expect(rowOf("l3")!.className).toContain("animate-fade-in");
    expect(rowOf("l1")!.className).not.toContain("animate-fade-in");
  });

  it("keeps the context drawer on screen while it slides out, then unmounts it", async () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      if ((el as Element).tagName !== "ASIDE") return style;
      return new Proxy(style, {
        get: (target, key) =>
          key === "animationName"
            ? "drawer-out"
            : key === "animationDuration"
              ? "0.18s"
              : key === "animationDelay"
                ? "0s"
                : Reflect.get(target, key),
      });
    });
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Context" }));
    const drawer = await screen.findByRole("complementary", { name: "Context" });
    await user.click(within(drawer).getByRole("button", { name: "Close" }));

    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("complementary", { name: "Context" })).not.toBeInTheDocument();

    ended(drawer);
    expect(drawer).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("dims a day while its removal is on its way, and brings it back if refused", async () => {
    let refuse: (error: Error) => void = () => {};
    store.send.mockImplementationOnce(() => new Promise((_, reject) => (refuse = reject)));
    const user = userEvent.setup();
    const day = await ready();
    await user.click(screen.getByRole("button", { name: "Squat day actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove Squat day" }));
    await user.click(screen.getByRole("button", { name: "Confirm remove squat day" }));
    expect(day).toHaveAttribute("aria-busy", "true");
    expect(day.className).toContain("animate-dim");
    refuse(new Error("not-allowed"));
    await waitFor(() => expect(day).not.toHaveAttribute("aria-busy"));
  });
});
