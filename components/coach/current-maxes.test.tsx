import { render, screen, waitFor } from "@testing-library/react";
import { CurrentMaxes } from "./current-maxes";

const store = vi.hoisted(() => ({
  fetchReferenceMaxes: vi.fn(),
  fetchEstimatedMaxes: vi.fn(),
}));
vi.mock("@/lib/strength/reference-max-store", () => store);

const library = vi.hoisted(() => ({ fetchExerciseLibrary: vi.fn() }));
vi.mock("@/lib/exercises/library", () => library);

const SQUAT = "ex-squat";
const BENCH = "ex-bench";

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
  store.fetchReferenceMaxes.mockResolvedValue([]);
  store.fetchEstimatedMaxes.mockResolvedValue(new Map());
  library.fetchExerciseLibrary.mockResolvedValue([
    exercise(SQUAT, "Squat"),
    exercise(BENCH, "Bench Press"),
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

describe("an athlete with maxes", () => {
  it("shows each number with the source and date it came from", async () => {
    store.fetchReferenceMaxes.mockResolvedValue([maxRow({ kind: "tested" })]);
    render(<CurrentMaxes athleteId="joey" />);

    const row = await screen.findByRole("row", { name: /Squat/ });
    expect(row).toHaveTextContent("tested");
    expect(row).toHaveTextContent("180");
    expect(row).toHaveTextContent("12 Aug");
  });

  it("labels a rolling estimate as e1RM, not as a tested max", async () => {
    // The distinction the panel exists for: nobody lifted this, it was
    // inferred, and a coach must be able to see that at a glance.
    store.fetchEstimatedMaxes.mockResolvedValue(
      new Map([[BENCH, { valueKg: 142, asOf: "2026-09-11T00:00:00.000Z" }]]),
    );
    render(<CurrentMaxes athleteId="joey" />);

    const row = await screen.findByRole("row", { name: /Bench Press/ });
    expect(row).toHaveTextContent("e1RM");
    expect(row).toHaveTextContent("142");
  });

  it("prefers the training max over the estimate", async () => {
    store.fetchReferenceMaxes.mockResolvedValue([maxRow({ valueKg: 170 })]);
    store.fetchEstimatedMaxes.mockResolvedValue(
      new Map([[SQUAT, { valueKg: 191, asOf: "2026-09-11T00:00:00.000Z" }]]),
    );
    render(<CurrentMaxes athleteId="joey" />);

    const row = await screen.findByRole("row", { name: /Squat/ });
    expect(row).toHaveTextContent("training max");
    expect(row).toHaveTextContent("170");
    expect(row).not.toHaveTextContent("191");
  });

  it("leaves out lifts with no max at all", async () => {
    store.fetchReferenceMaxes.mockResolvedValue([maxRow()]);
    render(<CurrentMaxes athleteId="joey" />);

    await screen.findByRole("row", { name: /Squat/ });
    expect(screen.queryByRole("row", { name: /Bench Press/ })).not.toBeInTheDocument();
  });
});

describe("an athlete with nothing yet", () => {
  /** Ruairi's first session is an entirely empty account. */
  it("says so plainly instead of showing an empty table", async () => {
    render(<CurrentMaxes athleteId="joey" />);
    expect(await screen.findByText(/No maxes yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
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

    store.fetchReferenceMaxes.mockResolvedValue([maxRow({ valueKg: 205 })]);
    view.rerender(<CurrentMaxes athleteId="sam" />);

    await waitFor(() => expect(screen.getByText("205")).toBeInTheDocument());
    expect(screen.queryByText("180")).not.toBeInTheDocument();
  });
});
