import { render, screen, waitFor } from "@testing-library/react";
import { AdjustProgram } from "./adjust-program";

/**
 * "Adjust program" as a coach reaches it, including by typing a URL. The link
 * row decides; the program rows never get a say, and for an athlete who is not
 * linked they are not even asked for.
 */

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: "ruairi", name: "Ruairi", email: "" },
      coach: { isCoach: true, athleteIds: ["joey"] },
    },
    refresh: vi.fn(),
  }),
}));

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const links = vi.hoisted(() => ({ fetchLinkRows: vi.fn() }));
vi.mock("@/lib/coach/athlete-view-store", () => links);

const programs = vi.hoisted(() => ({ fetchPrograms: vi.fn() }));
vi.mock("@/lib/programming/program-store", () => programs);

const lines = vi.hoisted(() => ({ fetchTracedLine: vi.fn() }));
vi.mock("@/lib/coach/adjust-program-store", () => lines);

vi.mock("@/lib/auth/athletes", () => ({
  fetchAthleteNames: async (ids: string[]) => ids.map((id) => ({ id, name: id === "joey" ? "Joey Pang" : "Sam" })),
}));

const link = (over: Record<string, unknown> = {}) => ({
  coachId: "ruairi",
  athleteId: "joey",
  status: "active",
  linkedAt: "2026-09-02T10:00:00.000Z",
  revokedAt: null,
  ...over,
});

const program = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  coachId: "ruairi",
  athleteId: "joey",
  name: id === "autumn" ? "Autumn block" : id,
  status: "published",
  startOn: "2026-10-05",
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  links.fetchLinkRows.mockResolvedValue([link()]);
  programs.fetchPrograms.mockResolvedValue([program("autumn")]);
  lines.fetchTracedLine.mockResolvedValue({ id: "l1", athleteId: "joey", programId: "autumn", weekId: "w3", dayId: "d9" });
});

describe("a linked athlete", () => {
  it("opens the editor on the day the clip's set was prescribed from, replacing this hop in history", async () => {
    render(<AdjustProgram athleteId="joey" lineId="l1" />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/coach/programs/autumn?week=w3&day=d9&line=l1"));
    expect(links.fetchLinkRows).toHaveBeenCalledWith("ruairi", "joey");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens their current program from Athlete View, with no line to follow", async () => {
    render(<AdjustProgram athleteId="joey" lineId={null} />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/coach/programs/autumn"));
    expect(lines.fetchTracedLine).not.toHaveBeenCalled();
  });

  it("lists their programs when none is published", async () => {
    programs.fetchPrograms.mockResolvedValue([program("autumn", { status: "draft" })]);
    render(<AdjustProgram athleteId="joey" lineId={null} />);
    const open = await screen.findByRole("link", { name: /Autumn block/ });
    expect(open).toHaveAttribute("href", "/coach/programs/autumn");
    expect(screen.getByRole("heading", { name: "Joey Pang" })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("has a real empty state when nobody has written them a program", async () => {
    programs.fetchPrograms.mockResolvedValue([]);
    render(<AdjustProgram athleteId="joey" lineId="l1" />);
    expect(await screen.findByText("No program for Joey Pang yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write their first block" })).toHaveAttribute("href", "/coach/programs");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("a URL edited to reach somebody else", () => {
  it("refuses an athlete never linked to this coach, and reads nothing of theirs", async () => {
    links.fetchLinkRows.mockResolvedValue([]);
    programs.fetchPrograms.mockResolvedValue([program("theirs", { athleteId: "stranger" })]);
    render(<AdjustProgram athleteId="stranger" lineId="l1" />);

    expect(await screen.findByText("Not one of your athletes")).toBeInTheDocument();
    expect(links.fetchLinkRows).toHaveBeenCalledWith("ruairi", "stranger");
    expect(programs.fetchPrograms).not.toHaveBeenCalled();
    expect(lines.fetchTracedLine).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("refuses after a revoke, even though the coach can still read the block they wrote", async () => {
    links.fetchLinkRows.mockResolvedValue([link({ status: "revoked", revokedAt: "2026-09-20T08:00:00.000Z" })]);
    render(<AdjustProgram athleteId="joey" lineId="l1" />);

    expect(await screen.findByText("No longer linked")).toBeInTheDocument();
    expect(screen.queryByText(/Joey Pang/)).not.toBeInTheDocument();
    expect(programs.fetchPrograms).not.toHaveBeenCalled();
    expect(lines.fetchTracedLine).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("ignores a line from another athlete's program and opens this athlete's own", async () => {
    lines.fetchTracedLine.mockResolvedValue({ id: "sl", athleteId: "sam", programId: "sams", weekId: "sw", dayId: "sd" });
    programs.fetchPrograms.mockResolvedValue([program("autumn"), program("sams", { athleteId: "sam" })]);
    render(<AdjustProgram athleteId="joey" lineId="sl" />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/coach/programs/autumn"));
  });

  it("fails closed when the link cannot be checked", async () => {
    links.fetchLinkRows.mockRejectedValue(new Error("offline"));
    render(<AdjustProgram athleteId="joey" lineId={null} />);
    expect(await screen.findByText("Couldn’t open their program")).toBeInTheDocument();
    expect(programs.fetchPrograms).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
