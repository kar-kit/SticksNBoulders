import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nextMonday, ProgramList } from "./program-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "ruairi" }, coach: { isCoach: true, athleteIds: ["joey"] } },
  }),
}));
vi.mock("@/lib/auth/athletes", () => ({ fetchAthleteNames: async () => [{ id: "joey", name: "Joey" }] }));

const store = vi.hoisted(() => ({
  programs: [] as unknown[],
  send: vi.fn<(op: Record<string, unknown>) => Promise<{ rowId: string }>>(),
}));
vi.mock("@/lib/programming/program-store", () => ({
  fetchPrograms: async () => store.programs,
  sendProgramOp: (op: Record<string, unknown>) => store.send(op),
}));

beforeEach(() => {
  vi.clearAllMocks();
  store.programs = [];
  store.send.mockImplementation(async (op) => ({ rowId: `${op.op}-id` }));
});

describe("Programs", () => {
  it("lists each linked athlete and the coach themselves, with an honest empty state", async () => {
    render(<ProgramList />);
    expect(await screen.findByRole("region", { name: "Joey" })).toHaveTextContent("Nothing written yet.");
    expect(screen.getByRole("region", { name: "Yourself" })).toBeInTheDocument();
  });

  it("lists what has been written, with its status", async () => {
    store.programs = [
      { id: "p1", coachId: "ruairi", athleteId: "joey", name: "Autumn", status: "published", startOn: "2026-10-05", updatedAt: "" },
    ];
    render(<ProgramList />);
    expect(await screen.findByRole("link", { name: /Autumn/ })).toHaveAttribute("href", "/coach/programs/p1");
    expect(screen.getByRole("link", { name: /Autumn/ })).toHaveTextContent("Published · from 2026-10-05");
  });

  it("starts a block with its first block and week, then opens the editor", async () => {
    const user = userEvent.setup();
    render(<ProgramList />);
    const joey = await screen.findByRole("region", { name: "Joey" });
    await user.click(joey.querySelector("button")!);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Autumn");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/coach/programs/createProgram-id"));
    expect(store.send.mock.calls.map(([op]) => op.op)).toEqual(["createProgram", "addBlock", "addWeek"]);
    expect(store.send.mock.calls[0][0]).toMatchObject({ athleteId: "joey", name: "Autumn" });
  });
});

describe("the default start date", () => {
  it("is the Monday on or after today", () => {
    expect(nextMonday("2026-10-06")).toBe("2026-10-12"); // a Tuesday
    expect(nextMonday("2026-10-05")).toBe("2026-10-05"); // already Monday
    expect(nextMonday("2026-10-11")).toBe("2026-10-12"); // Sunday
  });
});
