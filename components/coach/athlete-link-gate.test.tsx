import { act, render, screen, waitFor } from "@testing-library/react";
import { AthleteLinkGate } from "./athlete-link-gate";
import type { CoachLinkRecord } from "@/lib/coach/link-status";

const links = vi.hoisted(() => ({
  fetchCoachLinks: vi.fn(),
  subscribeToLinks: vi.fn(),
  canSeeCircle: vi.fn(),
}));
vi.mock("@/lib/coach/coach-links-store", () => links);

vi.mock("@/appwrite/browser-client", () => ({ browserAppwrite: () => ({ databaseId: "db" }) }));

const session = vi.hoisted(() => ({
  athleteIds: [] as string[],
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: "coach", name: "Ruairi Deane", email: "r@example.com" },
      coach: { isCoach: session.athleteIds.length > 0, athleteIds: session.athleteIds },
    },
    refresh: session.refresh,
  }),
}));

const panels = <p>Current maxes panel</p>;
let onLinkChange: () => void = () => {};

beforeEach(() => {
  session.athleteIds = [];
  session.refresh.mockResolvedValue(undefined);
  links.canSeeCircle.mockResolvedValue(true);
  links.subscribeToLinks.mockImplementation((_db: string, cb: () => void) => {
    onLinkChange = cb;
    return () => {};
  });
});

const records = (...rows: CoachLinkRecord[]) => rows;

describe("a linked athlete", () => {
  it("renders the panels on the first paint, before the check returns", () => {
    session.athleteIds = ["joey"];
    links.fetchCoachLinks.mockReturnValue(new Promise(() => {}));
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    expect(screen.getByText("Current maxes panel")).toBeInTheDocument();
  });

  it("does not refresh the session when it already agrees", async () => {
    session.athleteIds = ["joey"];
    links.fetchCoachLinks.mockResolvedValue(records({ athleteId: "joey", status: "active", revokedAt: null }));
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    await waitFor(() => expect(links.fetchCoachLinks).toHaveBeenCalled());
    expect(session.refresh).not.toHaveBeenCalled();
  });
});

describe("an athlete who unlinked", () => {
  it("shows the no-longer-linked state, dated, instead of the panels", async () => {
    links.fetchCoachLinks.mockResolvedValue(
      records({ athleteId: "joey", status: "revoked", revokedAt: "2026-09-26T09:00:00.000Z" }),
    );
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    expect(await screen.findByText("No longer linked")).toBeInTheDocument();
    expect(screen.getByText(/stopped sharing their training with you on 26 Sep/)).toBeInTheDocument();
    expect(screen.queryByText("Current maxes panel")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your roster" })).toHaveAttribute("href", "/coach/roster");
  });

  it("swaps the panels out when the session was stale, and corrects the session", async () => {
    // Loaded while linked; the athlete unlinked before this navigation.
    session.athleteIds = ["joey"];
    links.fetchCoachLinks.mockResolvedValue(
      records({ athleteId: "joey", status: "revoked", revokedAt: "2026-09-26T09:00:00.000Z" }),
    );
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    expect(await screen.findByText("No longer linked")).toBeInTheDocument();
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it("goes live: an unlink while the coach is looking replaces the panels", async () => {
    session.athleteIds = ["joey"];
    links.fetchCoachLinks.mockResolvedValue(records({ athleteId: "joey", status: "active", revokedAt: null }));
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    await waitFor(() => expect(links.fetchCoachLinks).toHaveBeenCalledTimes(1));

    links.fetchCoachLinks.mockResolvedValue(
      records({ athleteId: "joey", status: "revoked", revokedAt: "2026-09-27T10:00:00.000Z" }),
    );
    act(() => onLinkChange());
    expect(await screen.findByText("No longer linked")).toBeInTheDocument();
  });

  it("comes back on re-link without a reload", async () => {
    links.fetchCoachLinks.mockResolvedValue(
      records({ athleteId: "joey", status: "revoked", revokedAt: "2026-09-26T09:00:00.000Z" }),
    );
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    await screen.findByText("No longer linked");

    links.fetchCoachLinks.mockResolvedValue(records({ athleteId: "joey", status: "active", revokedAt: null }));
    act(() => onLinkChange());
    expect(await screen.findByText("Current maxes panel")).toBeInTheDocument();
    // The rail was missing them; the session catches up in the same moment.
    expect(session.refresh).toHaveBeenCalled();
  });
});

describe("a link recorded before its access lands", () => {
  it("holds the panels back until the circle is visible, then renders them", async () => {
    // A live re-link: the row flips to active a moment before the membership.
    links.fetchCoachLinks.mockResolvedValue(records({ athleteId: "joey", status: "active", revokedAt: null }));
    links.canSeeCircle.mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    expect(await screen.findByText("Linked, nothing showing yet")).toBeInTheDocument();
    expect(screen.queryByText("Current maxes panel")).not.toBeInTheDocument();
    expect(await screen.findByText("Current maxes panel", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe("somebody who was never linked", () => {
  it("does not render the panels or confirm the person exists", async () => {
    links.fetchCoachLinks.mockResolvedValue(records());
    render(<AthleteLinkGate athleteId="stranger">{panels}</AthleteLinkGate>);
    expect(await screen.findByText("Not one of your athletes")).toBeInTheDocument();
    expect(screen.queryByText("Current maxes panel")).not.toBeInTheDocument();
  });

  it("shows a loading line, not the panels, while it checks", () => {
    links.fetchCoachLinks.mockReturnValue(new Promise(() => {}));
    render(<AthleteLinkGate athleteId="stranger">{panels}</AthleteLinkGate>);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Current maxes panel")).not.toBeInTheDocument();
  });
});

describe("when the check itself fails", () => {
  it("trusts the session for an athlete it lists", async () => {
    session.athleteIds = ["joey"];
    links.fetchCoachLinks.mockRejectedValue(new Error("offline"));
    render(<AthleteLinkGate athleteId="joey">{panels}</AthleteLinkGate>);
    await waitFor(() => expect(links.fetchCoachLinks).toHaveBeenCalled());
    expect(screen.getByText("Current maxes panel")).toBeInTheDocument();
  });

  it("says so, rather than rendering panels the session never granted", async () => {
    links.fetchCoachLinks.mockRejectedValue(new Error("offline"));
    render(<AthleteLinkGate athleteId="stranger">{panels}</AthleteLinkGate>);
    expect(await screen.findByText("Couldn’t load this athlete")).toBeInTheDocument();
  });
});
