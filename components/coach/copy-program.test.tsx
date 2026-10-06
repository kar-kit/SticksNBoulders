import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyProgram } from "./copy-program";
import { ProgramEditor } from "./program-editor";
import type { ProgramTree } from "@/lib/programming/program";

/** Order 20 in the editor: the Duplicate week button and the Copy to… form. */

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: "ruairi", name: "R", email: "r@e.com" },
      coach: { isCoach: true, athleteIds: ["joey", "andrea"] },
    },
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/athletes", () => ({
  fetchAthleteNames: async () => [
    { id: "joey", name: "Joey Pang" },
    { id: "andrea", name: "Andrea" },
  ],
}));
vi.mock("@/lib/exercises/library", () => ({ fetchExerciseLibrary: async () => [] }));

const store = vi.hoisted(() => ({
  tree: null as unknown,
  send: vi.fn<(op: Record<string, unknown>) => Promise<{ rowId: string }>>(),
}));
vi.mock("@/lib/programming/program-store", () => ({
  fetchProgramTree: async () => store.tree,
  sendProgramOp: (op: Record<string, unknown>) => store.send(op),
}));

const week = (id: string, blockId: string, position: number) => ({
  id,
  programId: "p1",
  blockId,
  position,
  label: null,
  status: "draft" as const,
  notes: null,
  days: [],
});

const tree = (): ProgramTree => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Autumn",
  status: "draft",
  startOn: "2026-10-05",
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "",
  blocks: [
    { id: "b1", programId: "p1", position: 0, name: "Volume", notes: null, weeks: [week("w1", "b1", 0)] },
    { id: "b2", programId: "p1", position: 1, name: "Peak", notes: null, weeks: [week("w3", "b2", 0)] },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  store.tree = tree();
  store.send.mockResolvedValue({ rowId: "copy1" });
});

describe("Duplicate week", () => {
  it("sends one op for the week on screen and opens the copy", async () => {
    const user = userEvent.setup();
    render(<ProgramEditor programId="p1" />);
    await user.click(await screen.findByRole("button", { name: "Duplicate week 1" }));
    await waitFor(() => expect(store.send).toHaveBeenCalledWith({ op: "duplicateWeek", weekId: "w1" }));
  });
});

describe("Copy to…", () => {
  it("copies the whole program to a typed athlete, keeping its start date", async () => {
    const user = userEvent.setup();
    render(<CopyProgram tree={tree()} blockId="b2" />);
    await user.click(screen.getByRole("button", { name: "Copy to…" }));
    await user.type(screen.getByLabelText("Copy to"), "and");
    expect(await screen.findByRole("button", { name: "Andrea" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Joey Pang" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Andrea" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({
        op: "copyProgram",
        programId: "p1",
        athleteId: "andrea",
        startOn: "2026-10-05",
      }),
    );
    expect(await screen.findByRole("link", { name: "Open the copy" })).toHaveAttribute("href", "/coach/programs/copy1");
  });

  it("offers Yourself, and copies only the block on screen when asked", async () => {
    const user = userEvent.setup();
    render(<CopyProgram tree={tree()} blockId="b2" />);
    await user.click(screen.getByRole("button", { name: "Copy to…" }));
    await user.click(await screen.findByRole("button", { name: "Yourself" }));
    await user.click(screen.getByRole("checkbox", { name: "Only Peak" }));
    await user.clear(screen.getByLabelText("Starts"));
    await user.type(screen.getByLabelText("Starts"), "2026-11-02");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(store.send).toHaveBeenCalledWith({
        op: "copyProgram",
        programId: "p1",
        athleteId: "ruairi",
        blockId: "b2",
        startOn: "2026-11-02",
      }),
    );
  });

  it("says why when the server refuses, and links nothing", async () => {
    store.send.mockRejectedValueOnce(new Error("not-allowed"));
    const user = userEvent.setup();
    render(<CopyProgram tree={tree()} blockId="b1" />);
    await user.click(screen.getByRole("button", { name: "Copy to…" }));
    await user.click(await screen.findByRole("button", { name: "Joey Pang" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not-allowed");
    expect(screen.queryByRole("link", { name: "Open the copy" })).toBeNull();
  });
});
