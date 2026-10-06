import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrentMaxes } from "./current-maxes";

const store = vi.hoisted(() => ({
  fetchReferenceMaxes: vi.fn(),
  fetchEstimatedMaxes: vi.fn(),
  setReferenceMax: vi.fn(),
  removeReferenceMax: vi.fn(),
}));
vi.mock("@/lib/strength/reference-max-store", () => store);

const library = vi.hoisted(() => ({ fetchExerciseLibrary: vi.fn() }));
vi.mock("@/lib/exercises/library", () => library);

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "coach", name: "Ruairi", email: "" }, coach: { isCoach: true, athleteIds: ["joey"] } },
    refresh: vi.fn(),
  }),
}));

const SQUAT = "ex-squat";
const BENCH = "ex-bench";
const DEADLIFT = "ex-dead";
const ROW = "ex-row";

const exercise = (id: string, name: string) => ({
  id,
  name,
  normalisedName: name.toLowerCase(),
  isGlobal: true,
  ownerId: null,
});

beforeEach(() => {
  // Braced, not concise: a concise arrow returns the mock and Vitest calls a
  // hook's return value as teardown.
  store.fetchReferenceMaxes.mockReset();
  store.fetchEstimatedMaxes.mockReset();
  store.setReferenceMax.mockReset();
  store.removeReferenceMax.mockReset();
  store.fetchReferenceMaxes.mockResolvedValue([]);
  store.fetchEstimatedMaxes.mockResolvedValue(new Map());
  library.fetchExerciseLibrary.mockResolvedValue([
    exercise(SQUAT, "Squat"),
    exercise(BENCH, "Bench Press"),
    exercise(DEADLIFT, "Deadlift"),
    exercise(ROW, "Barbell Row"),
  ]);
});

const maxRow = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  exerciseId: SQUAT,
  kind: "training" as const,
  valueKg: 180,
  effectiveFrom: "2026-08-12T00:00:00.000Z",
  recordedBy: "coach",
  ...over,
});

const cells = (row: HTMLElement) => within(row).getAllByRole("cell");

describe("an athlete with maxes", () => {
  it("shows each number with the date and who set it", async () => {
    store.fetchReferenceMaxes.mockResolvedValue([maxRow({ kind: "tested", recordedBy: "joey" })]);
    render(<CurrentMaxes athleteId="joey" />);

    const row = await screen.findByRole("row", { name: /Squat/ });
    const [tested] = cells(row);
    expect(tested).toHaveTextContent("180");
    expect(tested).toHaveTextContent("12 Aug");
    expect(tested).toHaveTextContent("set by them");
  });

  it("shows all three kinds side by side, not just the preferred one", async () => {
    // The blueprint asks for three per lift. The old panel showed only the one
    // preferredMax picked, which hid exactly the comparison a coach wants.
    store.fetchReferenceMaxes.mockResolvedValue([
      maxRow({ id: "t", kind: "tested", valueKg: 200 }),
      maxRow({ id: "tm", valueKg: 170 }),
    ]);
    store.fetchEstimatedMaxes.mockResolvedValue(
      new Map([[SQUAT, { valueKg: 191, asOf: "2026-09-11T00:00:00.000Z" }]]),
    );
    render(<CurrentMaxes athleteId="joey" />);

    const row = await screen.findByRole("row", { name: /Squat/ });
    const [tested, training, estimated] = cells(row);
    expect(tested).toHaveTextContent("200");
    expect(training).toHaveTextContent("170");
    expect(estimated).toHaveTextContent("191");
    expect(estimated).toHaveTextContent("from logged sets");
  });

  it("marks the training max as the one percentages use", async () => {
    store.fetchReferenceMaxes.mockResolvedValue([maxRow({ id: "t", kind: "tested", valueKg: 200 }), maxRow()]);
    render(<CurrentMaxes athleteId="joey" />);

    const row = await screen.findByRole("row", { name: /Squat/ });
    const [tested, training] = cells(row);
    expect(within(training).getByLabelText("used for percentages")).toBeInTheDocument();
    expect(within(tested).queryByLabelText("used for percentages")).not.toBeInTheDocument();
  });

  it("leaves out non-competition lifts with no max at all", async () => {
    render(<CurrentMaxes athleteId="joey" />);
    await screen.findByRole("row", { name: /Squat/ });
    expect(screen.queryByRole("row", { name: /Barbell Row/ })).not.toBeInTheDocument();
  });
});

describe("an athlete with nothing yet", () => {
  /** Ruairi's first session is an entirely empty account. */
  it("still offers the three competition lifts to set a first max on", async () => {
    render(<CurrentMaxes athleteId="joey" />);
    expect(await screen.findByRole("button", { name: "Set training max for Squat" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Bench Press/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Deadlift/ })).toBeInTheDocument();
  });
});

describe("setting a max inline", () => {
  it("saves what the coach typed against the right lift and kind", async () => {
    store.setReferenceMax.mockResolvedValue("new-row");
    const user = userEvent.setup();
    render(<CurrentMaxes athleteId="joey" />);

    await user.click(await screen.findByRole("button", { name: "Set training max for Squat" }));
    await user.type(screen.getByLabelText("training max for Squat, kg"), "182,5{Enter}");

    await waitFor(() => expect(store.setReferenceMax).toHaveBeenCalledTimes(1));
    expect(store.setReferenceMax.mock.calls[0][0]).toMatchObject({
      athleteId: "joey",
      exerciseId: SQUAT,
      kind: "training",
      valueKg: 182.5,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 182.5 training max on Squat");
    // Refetched, so the grid shows what the server now holds.
    expect(store.fetchReferenceMaxes).toHaveBeenCalledTimes(2);
  });

  it("refuses something that is not a weight before any round trip", async () => {
    const user = userEvent.setup();
    render(<CurrentMaxes athleteId="joey" />);

    await user.click(await screen.findByRole("button", { name: "Set tested for Bench Press" }));
    await user.type(screen.getByLabelText("tested for Bench Press, kg"), "75%{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Type a weight in kilos");
    expect(store.setReferenceMax).not.toHaveBeenCalled();
  });

  it("shows the server's reason when it refuses", async () => {
    store.setReferenceMax.mockRejectedValue(new Error("A max over 600kg is a typo."));
    const user = userEvent.setup();
    render(<CurrentMaxes athleteId="joey" />);

    await user.click(await screen.findByRole("button", { name: "Set tested for Squat" }));
    await user.type(screen.getByLabelText("tested for Squat, kg"), "6000{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("A max over 600kg is a typo.");
  });

  it("cancels on Escape without writing", async () => {
    const user = userEvent.setup();
    render(<CurrentMaxes athleteId="joey" />);

    await user.click(await screen.findByRole("button", { name: "Set tested for Squat" }));
    await user.type(screen.getByLabelText("tested for Squat, kg"), "200{Escape}");

    expect(screen.queryByLabelText("tested for Squat, kg")).not.toBeInTheDocument();
    expect(store.setReferenceMax).not.toHaveBeenCalled();
  });

  it("undoes a save by deleting the row it just wrote", async () => {
    store.setReferenceMax.mockResolvedValue("new-row");
    store.removeReferenceMax.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CurrentMaxes athleteId="joey" />);

    await user.click(await screen.findByRole("button", { name: "Set training max for Deadlift" }));
    await user.type(screen.getByLabelText("training max for Deadlift, kg"), "220{Enter}");
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(store.removeReferenceMax).toHaveBeenCalledWith("new-row"));
  });
});

describe("when the read fails", () => {
  it("says the maxes could not load rather than showing none", async () => {
    // "No maxes yet" for a failed read would tell a coach their athlete has
    // never been tested, which is a different and much worse lie.
    store.fetchReferenceMaxes.mockImplementation(async () => {
      throw new Error("offline");
    });
    render(<CurrentMaxes athleteId="joey" />);
    expect(await screen.findByText(/Couldn’t load maxes/)).toBeInTheDocument();
  });
});

describe("switching athletes", () => {
  it("does not leave the previous athlete's numbers on screen", async () => {
    store.fetchReferenceMaxes.mockResolvedValue([maxRow({ valueKg: 180 })]);
    const view = render(<CurrentMaxes athleteId="joey" />);
    await screen.findByText("180");

    let release: (value: unknown) => void = () => {};
    store.fetchReferenceMaxes.mockReturnValue(new Promise((resolve) => (release = resolve)));
    view.rerender(<CurrentMaxes athleteId="sam" />);

    // Loading, not Joey's 180 under Sam's name, while Sam's numbers are on the way.
    expect(screen.queryByText("180")).not.toBeInTheDocument();
    release([maxRow({ valueKg: 205 })]);
    await waitFor(() => expect(screen.getByText("205")).toBeInTheDocument());
  });
});
