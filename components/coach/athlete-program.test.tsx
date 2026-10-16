import { render, screen, within } from "@testing-library/react";
import { AthleteProgram } from "./athlete-program";
import { addDays, localDay, type Program } from "@/lib/programming/program";

const programs = vi.hoisted(() => ({
  fetchPrograms: vi.fn(),
  fetchProgramTree: vi.fn(),
  fetchLoggedDayIds: vi.fn(),
}));
vi.mock("@/lib/programming/program-store", () => programs);

const maxes = vi.hoisted(() => ({ fetchReferenceMaxes: vi.fn(), fetchEstimatedMaxes: vi.fn() }));
vi.mock("@/lib/strength/reference-max-store", () => maxes);

const library = vi.hoisted(() => ({ fetchExerciseLibrary: vi.fn() }));
vi.mock("@/lib/exercises/library", () => library);

const today = localDay();

const program = (over: Partial<Program> = {}): Program => ({
  id: "p1",
  coachId: "coach",
  athleteId: "joey",
  name: "Volume block",
  status: "published",
  startOn: today,
  notes: null,
  templateId: null,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  ...over,
});

/** One week, starting today: a squat day today and a bench day in two days. */
const treeOf = (p: Program, weekStatus: "published" | "draft" = "published") => ({
  ...p,
  blocks: [
    {
      id: "b1",
      programId: p.id,
      position: 0,
      name: "Volume",
      notes: null,
      weeks: [
        {
          id: "w1",
          programId: p.id,
          blockId: "b1",
          position: 0,
          label: null,
          status: weekStatus,
          notes: null,
          days: [
            {
              id: "d1",
              programId: p.id,
              blockId: "b1",
              weekId: "w1",
              position: 0,
              label: "Day 1 — squat",
              scheduledOn: today,
              notes: null,
              prescriptions: [
                {
                  id: "l1",
                  programId: p.id,
                  weekId: "w1",
                  dayId: "d1",
                  exerciseId: "squat",
                  position: 0,
                  setCount: 3,
                  reps: 5,
                  repMax: null,
                  load: "75%",
                  loadKind: "percent",
                  restSeconds: null,
                  notes: null,
                  updatedAt: "",
                },
              ],
            },
            {
              id: "d2",
              programId: p.id,
              blockId: "b1",
              weekId: "w1",
              position: 1,
              label: "Day 2 — bench",
              scheduledOn: addDays(today, 2),
              notes: null,
              prescriptions: [],
            },
          ],
        },
      ],
    },
  ],
});

beforeEach(() => {
  programs.fetchPrograms.mockReset();
  programs.fetchProgramTree.mockReset();
  programs.fetchLoggedDayIds.mockReset();
  programs.fetchLoggedDayIds.mockResolvedValue(new Set(["d1"]));
  maxes.fetchReferenceMaxes.mockResolvedValue([
    { id: "m", exerciseId: "squat", kind: "training", valueKg: 200, effectiveFrom: "2026-08-01T00:00:00Z", recordedBy: "coach" },
  ]);
  maxes.fetchEstimatedMaxes.mockResolvedValue(new Map());
  library.fetchExerciseLibrary.mockResolvedValue([{ id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true, ownerId: null }]);
});

const section = () => screen.getByRole("region", { name: "This block" });

describe("a published block", () => {
  it("shows the program, that it is published, and the current week's days with loads in kilos", async () => {
    programs.fetchPrograms.mockResolvedValue([program()]);
    programs.fetchProgramTree.mockResolvedValue(treeOf(program()));
    render(<AthleteProgram athleteId="joey" />);

    expect(await within(section()).findByText("Volume block")).toBeInTheDocument();
    expect(within(section()).getByText("Published")).toBeInTheDocument();
    expect(within(section()).getByText(/Week 1 of 1/)).toBeInTheDocument();
    const squatDay = within(section()).getByText("Day 1 — squat").closest("li")!;
    expect(squatDay).toHaveTextContent("Squat");
    expect(squatDay).toHaveTextContent("3 × 5 · 150 kg (75%)");
    expect(squatDay).toHaveTextContent("Logged");
    expect(squatDay).toHaveTextContent("Today");
    expect(within(section()).getByText("No exercises on this day yet.")).toBeInTheDocument();
    expect(programs.fetchProgramTree).toHaveBeenCalledWith("p1");
    expect(programs.fetchLoggedDayIds).toHaveBeenCalledWith("joey", ["d1", "d2"]);
  });

  it("keeps Adjust program, pointing at this athlete's block", async () => {
    programs.fetchPrograms.mockResolvedValue([program()]);
    programs.fetchProgramTree.mockResolvedValue(treeOf(program()));
    render(<AthleteProgram athleteId="joey" />);
    expect(await screen.findByRole("link", { name: "Adjust program" })).toHaveAttribute("href", "/coach/programs?athlete=joey");
    expect(screen.queryByText(/will sit here later/)).not.toBeInTheDocument();
  });

  it("says when the current week is still a draft the athlete cannot see", async () => {
    programs.fetchPrograms.mockResolvedValue([program()]);
    programs.fetchProgramTree.mockResolvedValue(treeOf(program(), "draft"));
    render(<AthleteProgram athleteId="joey" />);
    expect(await within(section()).findByText("Draft week")).toBeInTheDocument();
    expect(within(section()).getByText(/they can’t see this week yet/)).toBeInTheDocument();
  });

  it("leaves the logged marks off when sessions could not be read, rather than claiming none", async () => {
    programs.fetchPrograms.mockResolvedValue([program()]);
    programs.fetchProgramTree.mockResolvedValue(treeOf(program()));
    programs.fetchLoggedDayIds.mockRejectedValue(new Error("offline"));
    render(<AthleteProgram athleteId="joey" />);
    await within(section()).findByText("Day 1 — squat");
    expect(within(section()).queryByText("Logged")).not.toBeInTheDocument();
    expect(within(section()).getByText("3 × 5 · 150 kg (75%)")).toBeInTheDocument();
  });
});

describe("a draft block", () => {
  it("shows it, marked as a draft, when nothing is published", async () => {
    const draft = program({ status: "draft" });
    programs.fetchPrograms.mockResolvedValue([draft]);
    programs.fetchProgramTree.mockResolvedValue(treeOf(draft));
    render(<AthleteProgram athleteId="joey" />);
    expect(await within(section()).findByText("Draft")).toBeInTheDocument();
    expect(within(section()).getByText(/they can’t see this week yet/)).toBeInTheDocument();
  });
});

describe("nothing written", () => {
  it("is a real empty state, with the way to start one", async () => {
    programs.fetchPrograms.mockResolvedValue([]);
    render(<AthleteProgram athleteId="joey" />);
    expect(await screen.findByText(/Nobody has written them a block yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Adjust program" })).toBeInTheDocument();
    expect(programs.fetchProgramTree).not.toHaveBeenCalled();
  });

  it("says it could not load, rather than that there is none", async () => {
    programs.fetchPrograms.mockRejectedValue(new Error("offline"));
    render(<AthleteProgram athleteId="joey" />);
    expect(await screen.findByText(/Couldn’t load their program/)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody has written/)).not.toBeInTheDocument();
  });
});
