import { render, screen, waitFor, within } from "@testing-library/react";
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

const store = vi.hoisted(() => ({
  tree: null as unknown,
  send: vi.fn<(op: Record<string, unknown>) => Promise<{ rowId: string }>>(),
}));
vi.mock("@/lib/programming/program-store", () => ({
  fetchProgramTree: async () => store.tree,
  sendProgramOp: (op: Record<string, unknown>) => store.send(op),
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
  store.tree = tree();
  store.send.mockResolvedValue({ rowId: "new" });
});

const ready = async () => {
  render(<ProgramEditor programId="p1" />);
  return screen.findByRole("region", { name: "Squat day" });
};

describe("the Program Editor grid", () => {
  it("lays out weeks across the top and the day's lines with what each load cell landed as", async () => {
    const day = await ready();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Week 1", "Week 2"]);
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

  it("publishes the whole block in one press, and asks before removing a day", async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "publishProgram", programId: "p1" }));

    await user.click(screen.getByRole("button", { name: "Remove Squat day" }));
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
    await user.click(screen.getByRole("tab", { name: /Week 2/ }));
    await user.click(screen.getByRole("button", { name: "Publish week 2" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "publishWeek", weekId: "w2" }));

    await user.click(screen.getByRole("tab", { name: "Week 1" }));
    await user.click(screen.getByRole("button", { name: "Unpublish week 1" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({ op: "updateWeek", weekId: "w1", status: "draft" }),
    );
  });

  it("is read-only for anyone but the coach who wrote it", async () => {
    viewer.id = "louis";
    await ready();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Publish|Unpublish) week/ })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Load, line 1" })).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says so when the program cannot be read, rather than showing an empty grid", async () => {
    store.tree = null;
    render(<ProgramEditor programId="nope" />);
    expect(await screen.findByText("No such program")).toBeInTheDocument();
  });
});
