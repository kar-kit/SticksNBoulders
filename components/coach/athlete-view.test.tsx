import { render, screen } from "@testing-library/react";
import { AthleteView } from "./athlete-view";

const store = vi.hoisted(() => ({ fetchLinkRows: vi.fn() }));
vi.mock("@/lib/coach/athlete-view-store", () => store);

const names = vi.hoisted(() => ({ fetchAthleteNames: vi.fn() }));
vi.mock("@/lib/auth/athletes", () => names);

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: "coach", name: "Ruairi", email: "" },
      coach: { isCoach: true, athleteIds: ["joey"] },
    },
    refresh: vi.fn(),
  }),
}));

// The panels are tested on their own. Here they are stand-ins, so what is
// under test is only whether the gate lets them be seen.
const { panel } = vi.hoisted(() => ({
  panel: (label: string) =>
    function Panel() {
      return <section aria-label={label}>{label}</section>;
    },
}));
vi.mock("@/components/coach/current-maxes", () => ({ CurrentMaxes: panel("Current maxes panel") }));
vi.mock("@/components/coach/athlete-lifts", () => ({ AthleteLifts: panel("Lifts panel") }));
vi.mock("@/components/coach/athlete-sessions", () => ({ AthleteSessions: panel("Sessions panel") }));
vi.mock("@/components/coach/athlete-videos", () => ({ AthleteVideos: panel("Videos panel") }));
vi.mock("@/components/coach/athlete-bodyweight", () => ({ AthleteBodyweight: panel("Bodyweight panel") }));
vi.mock("@/components/coach/recent-feedback", () => ({ RecentFeedback: panel("Feedback panel") }));
vi.mock("@/components/strength/dots-block", () => ({ DotsBlock: panel("DOTS panel") }));
vi.mock("@/components/coach/suggestion-switch", () => ({ SuggestionSwitch: panel("Suggestions panel") }));

const row = (over: Record<string, unknown> = {}) => ({
  coachId: "coach",
  athleteId: "joey",
  status: "active",
  linkedAt: "2026-09-02T10:00:00.000Z",
  revokedAt: null,
  ...over,
});

beforeEach(() => {
  store.fetchLinkRows.mockReset();
  names.fetchAthleteNames.mockReset();
  names.fetchAthleteNames.mockResolvedValue([{ id: "joey", name: "Joey Pang" }]);
});

describe("a linked athlete", () => {
  it("shows their name, when they linked, and every panel", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    render(<AthleteView athleteId="joey" />);

    expect(await screen.findByRole("heading", { name: "Joey Pang" })).toBeInTheDocument();
    expect(screen.getByText("linked 2 Sep")).toBeInTheDocument();
    for (const label of ["Current maxes panel", "Lifts panel", "Sessions panel", "Videos panel", "Bodyweight panel", "DOTS panel", "Feedback panel"]) {
      expect(screen.getByRole("region", { name: label })).toBeVisible();
    }
    expect(store.fetchLinkRows).toHaveBeenCalledWith("coach", "joey");
  });

  it("links to their program in the editor rather than claiming they have none", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    render(<AthleteView athleteId="joey" />);
    expect(await screen.findByRole("link", { name: "Adjust program" })).toHaveAttribute(
      "href",
      "/coach/programs?athlete=joey",
    );
    expect(screen.queryByText("No program yet")).not.toBeInTheDocument();
  });

  it("does not show a hex id when they have no profile yet", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    names.fetchAthleteNames.mockResolvedValue([]);
    render(<AthleteView athleteId="joey" />);
    expect(await screen.findByRole("heading", { name: "Unnamed athlete" })).toBeInTheDocument();
  });
});

describe("before the link is confirmed", () => {
  it("shows none of their training", () => {
    store.fetchLinkRows.mockReturnValue(new Promise(() => {}));
    render(<AthleteView athleteId="joey" />);
    expect(screen.queryByRole("region", { name: "Current maxes panel" })).not.toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

describe("an athlete who ended the link", () => {
  it("says so, with the date, and shows nothing of theirs", async () => {
    store.fetchLinkRows.mockResolvedValue([row({ status: "revoked", revokedAt: "2026-09-20T08:00:00.000Z" })]);
    render(<AthleteView athleteId="joey" />);

    expect(await screen.findByText("No longer linked")).toBeInTheDocument();
    expect(screen.getByText(/ended the link on 20 Sep/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Current maxes panel" })).not.toBeInTheDocument();
    // Not named: whether a coach is told who left is Ruairi's call (Order 16.6).
    expect(screen.queryByText(/Joey Pang/)).not.toBeInTheDocument();
  });
});

describe("somebody who was never linked", () => {
  it("is refused with words, not a blank page", async () => {
    store.fetchLinkRows.mockResolvedValue([]);
    render(<AthleteView athleteId="joey" />);

    expect(await screen.findByText("Not one of your athletes")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Current maxes panel" })).not.toBeInTheDocument();
  });
});

describe("when the link cannot be checked", () => {
  it("fails closed and says why", async () => {
    store.fetchLinkRows.mockRejectedValue(new Error("offline"));
    render(<AthleteView athleteId="joey" />);

    expect(await screen.findByText("Couldn’t check this link")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Current maxes panel" })).not.toBeInTheDocument();
  });
});
