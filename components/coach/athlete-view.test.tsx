import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// The URL the overlays are read from. Mutable so a test can open one.
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/coach/athletes/joey",
}));

// The panels are tested on their own. Here they are stand-ins, so what is
// under test is only whether the gate lets them be seen, where they sit, and
// what the page hands them.
const { panel } = vi.hoisted(() => ({
  panel: (label: string) =>
    function Panel() {
      return <section aria-label={label}>{label}</section>;
    },
}));
vi.mock("@/components/coach/current-maxes", () => ({ CurrentMaxes: panel("Current maxes panel") }));
vi.mock("@/components/coach/athlete-lifts", () => ({ AthleteLifts: panel("Lifts panel") }));
vi.mock("@/components/coach/athlete-sessions", () => ({ AthleteSessions: panel("Sessions panel") }));
vi.mock("@/components/coach/athlete-program", () => ({ AthleteProgram: panel("Program panel") }));
vi.mock("@/components/coach/suggestion-switch", () => ({ SuggestionSwitch: panel("Suggestions panel") }));
vi.mock("@/components/export/export-log", () => ({ ExportLog: panel("Export panel") }));
vi.mock("@/components/coach/athlete-videos", () => ({
  AthleteVideos: ({ athleteName, openClipId, onOpen }: { athleteName: string | null; openClipId: string | null; onOpen: (id: string) => void }) => (
    <section aria-label="Videos panel">
      <button type="button" onClick={() => onOpen("set-1")}>
        open clip
      </button>
      <span>thread names {athleteName ?? "none"}</span>
      <span>open clip {openClipId ?? "none"}</span>
    </section>
  ),
}));
vi.mock("@/components/coach/athlete-bodyweight", () => ({
  AthleteBodyweight: ({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) => (
    <span aria-label="Bodyweight figure">
      <button type="button" onClick={onOpen}>
        82.3 kg
      </button>
      {open ? (
        <button type="button" onClick={onClose}>
          close bodyweight
        </button>
      ) : null}
    </span>
  ),
}));

const row = (over: Record<string, unknown> = {}) => ({
  coachId: "coach",
  athleteId: "joey",
  status: "active",
  // 10:00 local on 2 Sep wherever the suite runs: the header shows the
  // viewer's calendar day, and a UTC instant is 3 Sep east of +14h.
  linkedAt: new Date(2026, 8, 2, 10, 0).toISOString(),
  revokedAt: null,
  ...over,
});

beforeEach(() => {
  nav.search = "";
  window.history.replaceState(null, "", "/coach/athletes/joey");
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
    for (const label of ["Current maxes panel", "Program panel", "Videos panel", "Lifts panel", "Sessions panel", "Export panel"]) {
      expect(screen.getByRole("region", { name: label })).toBeVisible();
    }
    expect(store.fetchLinkRows).toHaveBeenCalledWith("coach", "joey");
  });

  it("puts the bodyweight and the load-suggestion setting in the header, beside the name", async () => {
    // Joey, 16 Oct 2026: bodyweight up next to the name, suggestions demoted
    // to a compact setting rather than a panel among the rest.
    store.fetchLinkRows.mockResolvedValue([row()]);
    render(<AthleteView athleteId="joey" />);
    const header = (await screen.findByRole("heading", { name: "Joey Pang" })).closest("header")!;
    expect(within(header).getByLabelText("Bodyweight figure")).toBeInTheDocument();
    expect(within(header).getByRole("region", { name: "Suggestions panel" })).toBeInTheDocument();
    expect(within(header).getByText("linked 2 Sep")).toBeInTheDocument();
  });

  it("leads with maxes, videos and the block, with history below them", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    render(<AthleteView athleteId="joey" />);
    await screen.findByRole("heading", { name: "Joey Pang" });
    const order = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    const at = (label: string) => order.indexOf(label);
    expect(at("Current maxes panel")).toBeLessThan(at("Lifts panel"));
    expect(at("Program panel")).toBeLessThan(at("Lifts panel"));
    expect(at("Videos panel")).toBeLessThan(at("Lifts panel"));
    expect(at("Lifts panel")).toBeLessThan(at("Sessions panel"));
  });

  it("no longer has separate DOTS or recent feedback panels", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    render(<AthleteView athleteId="joey" />);
    await screen.findByRole("heading", { name: "Joey Pang" });
    expect(screen.queryByText(/Recent feedback/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "DOTS" })).not.toBeInTheDocument();
  });

  it("opens the bodyweight view in the URL, so Back closes it", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    const push = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    render(<AthleteView athleteId="joey" />);
    await user.click(await screen.findByRole("button", { name: "82.3 kg" }));
    expect(push).toHaveBeenCalledWith(null, "", "/coach/athletes/joey?view=bodyweight");
    push.mockRestore();
  });

  it("opens a clip in the URL, and hands the thread the athlete's name", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    const push = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();
    render(<AthleteView athleteId="joey" />);
    await user.click(await screen.findByRole("button", { name: "open clip" }));
    expect(push).toHaveBeenCalledWith(null, "", "/coach/athletes/joey?clip=set-1");
    expect(screen.getByText("thread names Joey Pang")).toBeInTheDocument();
    push.mockRestore();
  });

  it("reads an open clip and the bodyweight view from the URL", async () => {
    store.fetchLinkRows.mockResolvedValue([row()]);
    nav.search = "clip=set-9";
    const { unmount } = render(<AthleteView athleteId="joey" />);
    expect(await screen.findByText("open clip set-9")).toBeInTheDocument();
    unmount();
    nav.search = "view=bodyweight";
    render(<AthleteView athleteId="joey" />);
    expect(await screen.findByRole("button", { name: "close bodyweight" })).toBeInTheDocument();
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

  it("opens no clip over the hidden panels, even when the URL asks", () => {
    store.fetchLinkRows.mockReturnValue(new Promise(() => {}));
    nav.search = "clip=set-9";
    render(<AthleteView athleteId="joey" />);
    expect(screen.queryByText("open clip set-9")).not.toBeInTheDocument();
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
