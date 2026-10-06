import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Roster } from "./roster";
import type { CoachLinkRecord } from "@/lib/coach/link-status";
import type { RosterInputs } from "@/lib/coach/roster";

const links = vi.hoisted(() => ({
  fetchCoachLinks: vi.fn(),
  subscribeToLinks: vi.fn(),
  canSeeCircle: vi.fn(),
}));
vi.mock("@/lib/coach/coach-links-store", () => links);

const store = vi.hoisted(() => ({ fetchRoster: vi.fn() }));
vi.mock("@/lib/coach/roster-store", () => store);

const clips = vi.hoisted(() => ({ subscribeToClips: vi.fn(() => () => {}) }));
vi.mock("@/lib/review/queue-store", () => clips);

vi.mock("@/appwrite/browser-client", () => ({ browserAppwrite: () => ({ databaseId: "db" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The invite panel has its own tests; here it only has to be the empty state's action.
vi.mock("@/components/coach/invite-code", () => ({ InviteCodePanel: () => <p>INVITE-CODE-PANEL</p> }));

const session = vi.hoisted(() => ({ athleteIds: [] as string[], refresh: vi.fn() }));
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

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const active = (athleteId: string, linkedAt = "2026-01-01T00:00:00.000Z"): CoachLinkRecord => ({
  athleteId,
  status: "active",
  revokedAt: null,
  linkedAt,
});
const revoked = (athleteId: string): CoachLinkRecord => ({
  athleteId,
  status: "revoked",
  revokedAt: new Date(Date.now() - 86_400_000).toISOString(),
  linkedAt: "2026-01-01T00:00:00.000Z",
});

const data = (over: Partial<Omit<RosterInputs, "links">> = {}): Omit<RosterInputs, "links"> => ({
  names: new Map([
    ["joey", "Joey Pang"],
    ["sam", "Sam Okafor"],
  ]),
  visible: new Map([
    ["joey", true],
    ["sam", true],
  ]),
  sessions: [],
  rollups: [],
  clips: [],
  reviewedSetIds: new Set(),
  bodyweight: [
    { id: "1", athleteId: "joey", weightKg: 82.4, measuredOn: today(), recordedAt: "" },
    { id: "2", athleteId: "sam", weightKg: 63.1, measuredOn: today(), recordedAt: "" },
  ],
  program: new Map(),
  ...over,
});

let onLinkChange: () => void = () => {};

beforeEach(() => {
  session.athleteIds = [];
  session.refresh.mockReset().mockResolvedValue(undefined);
  links.fetchCoachLinks.mockReset();
  links.subscribeToLinks.mockImplementation((_db: string, cb: () => void) => {
    onLinkChange = cb;
    return () => {};
  });
  store.fetchRoster.mockReset();
});

describe("loading", () => {
  it("says so while the roster is read, without blanking the screen", () => {
    session.athleteIds = ["joey"];
    links.fetchCoachLinks.mockReturnValue(new Promise(() => {}));
    store.fetchRoster.mockReturnValue(new Promise(() => {}));
    render(<Roster />);
    expect(screen.getByText("Loading…")).toHaveAttribute("aria-busy", "true");
  });
});

describe("an empty account -- Ruairi's first session", () => {
  it("shows the empty state with the invite code as its action, and reads nothing else", async () => {
    links.fetchCoachLinks.mockResolvedValue([]);
    render(<Roster />);
    expect(screen.getByText("No athletes yet")).toBeInTheDocument();
    expect(screen.getByText(/Share your invite code/)).toBeInTheDocument();
    expect(screen.getByText("INVITE-CODE-PANEL")).toBeInTheDocument();
    await waitFor(() => expect(links.fetchCoachLinks).toHaveBeenCalled());
    expect(store.fetchRoster).not.toHaveBeenCalled();
    expect(session.refresh).not.toHaveBeenCalled();
  });

  it("notices a first athlete linking live and refreshes the session", async () => {
    links.fetchCoachLinks.mockResolvedValue([]);
    render(<Roster />);
    await waitFor(() => expect(links.fetchCoachLinks).toHaveBeenCalledTimes(1));

    links.fetchCoachLinks.mockResolvedValue([active("joey")]);
    act(() => onLinkChange());
    await waitFor(() => expect(session.refresh).toHaveBeenCalled());
  });
});

describe("linked athletes", () => {
  beforeEach(() => {
    session.athleteIds = ["joey", "sam"];
    links.fetchCoachLinks.mockResolvedValue([active("joey"), active("sam")]);
  });

  it("lists everyone in a table, each row opening their Athlete View", async () => {
    store.fetchRoster.mockResolvedValue(data());
    render(<Roster />);
    const table = await screen.findByRole("table", { name: "Athletes" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/coach/athletes/joey", "/coach/athletes/sam"]);
    expect(within(rows[0]).getByText("Joey Pang")).toBeInTheDocument();
    expect(within(rows[0]).getByText("82.4")).toBeInTheDocument();
    expect(within(rows[0]).getByText("No block")).toBeInTheDocument();
    expect(screen.getByText("2 athletes")).toBeInTheDocument();
  });

  it("says nothing needs you when nothing does", async () => {
    store.fetchRoster.mockResolvedValue(data());
    render(<Roster />);
    expect(await screen.findByText("Nothing needs you today.")).toBeInTheDocument();
  });

  it("puts unreviewed videos in needs-you, linked to the queue", async () => {
    const clip = {
      id: "set1", athleteId: "sam", exerciseId: "squat", sessionId: "s", setIndex: 0, loadKg: 100, reps: 3,
      rpe: 8, e1rmKg: null, loggedAt: new Date().toISOString(), videoFileId: "f", notes: null,
    };
    store.fetchRoster.mockResolvedValue(data({ clips: [clip] }));
    render(<Roster />);
    const item = await screen.findByRole("link", { name: /Sam Okafor\s*1 video waiting/ });
    expect(item).toHaveAttribute("href", "/coach/review");
  });

  it("sorts when a header is clicked", async () => {
    store.fetchRoster.mockResolvedValue(data());
    render(<Roster />);
    const table = await screen.findByRole("table", { name: "Athletes" });
    await userEvent.click(within(table).getByRole("button", { name: "Bodyweight" }));
    const names = within(table).getAllByRole("row").slice(1).map((r) => r.getAttribute("href"));
    expect(names).toEqual(["/coach/athletes/joey", "/coach/athletes/sam"]);
    await userEvent.click(within(table).getByRole("button", { name: /Bodyweight/ }));
    const flipped = within(table).getAllByRole("row").slice(1).map((r) => r.getAttribute("href"));
    expect(flipped).toEqual(["/coach/athletes/sam", "/coach/athletes/joey"]);
    expect(within(table).getAllByRole("columnheader")[3]).toHaveAttribute("aria-sort", "ascending");
  });

  it("shows an athlete it cannot see yet as such, without triggers", async () => {
    store.fetchRoster.mockResolvedValue(data({ visible: new Map([["joey", true]]), bodyweight: [] }));
    render(<Roster />);
    expect(await screen.findByText("Linked, nothing showing yet")).toBeInTheDocument();
    // Joey has no weigh-ins but was linked long ago, so he fires; Sam is not visible, so he does not.
    expect(screen.getByRole("link", { name: /Joey Pang\s*no bodyweight logged yet/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sam Okafor\s*no bodyweight/ })).not.toBeInTheDocument();
  });

  it("says when the roster could not be read", async () => {
    store.fetchRoster.mockRejectedValue(new Error("offline"));
    render(<Roster />);
    expect(await screen.findByText("Couldn’t load your roster")).toBeInTheDocument();
  });
});

describe("a revoked athlete", () => {
  it("drops out of the table and the needs-you list, the session is corrected, and the notice says one left", async () => {
    // The session was read before Sam unlinked.
    session.athleteIds = ["joey", "sam"];
    links.fetchCoachLinks.mockResolvedValue([active("joey"), revoked("sam")]);
    store.fetchRoster.mockResolvedValue(data({ bodyweight: [] }));
    render(<Roster />);

    const table = await screen.findByRole("table", { name: "Athletes" });
    await waitFor(() =>
      expect(within(table).getAllByRole("row").slice(1).map((r) => r.getAttribute("href"))).toEqual([
        "/coach/athletes/joey",
      ]),
    );
    expect(screen.queryByText(/Sam Okafor/)).not.toBeInTheDocument();
    expect(session.refresh).toHaveBeenCalled();
    expect(await screen.findByText(/An athlete stopped sharing their training with you on/)).toBeInTheDocument();
  });

  it("leaves the empty state, with the notice, when the last athlete leaves", async () => {
    session.athleteIds = ["sam"];
    links.fetchCoachLinks.mockResolvedValue([revoked("sam")]);
    store.fetchRoster.mockResolvedValue(data());
    render(<Roster />);
    expect(await screen.findByText("No athletes yet")).toBeInTheDocument();
    expect(await screen.findByText(/An athlete stopped sharing their training with you on/)).toBeInTheDocument();
  });

  it("goes live: an unlink while the coach is looking removes the row", async () => {
    session.athleteIds = ["joey", "sam"];
    links.fetchCoachLinks.mockResolvedValue([active("joey"), active("sam")]);
    store.fetchRoster.mockResolvedValue(data());
    render(<Roster />);
    await screen.findByText("Sam Okafor");

    links.fetchCoachLinks.mockResolvedValue([active("joey"), revoked("sam")]);
    act(() => onLinkChange());
    await waitFor(() => expect(screen.queryByText("Sam Okafor")).not.toBeInTheDocument());
  });
});
