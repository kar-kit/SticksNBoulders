import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipsView } from "./clips-view";
import type { ClipSet } from "@/lib/review/queue";
import type { QueuedOp } from "@/lib/offline/queue";
import type { ClipPageRequest } from "@/lib/video/my-clips-store";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "joey", name: "Joey", email: "j@e.com" } },
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/exercises/library-context", () => ({
  useExerciseLibrary: () => ({
    state: {
      status: "ready",
      exercises: [
        { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
        { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
      ],
    },
  }),
}));

const units = vi.hoisted(() => ({ unit: "kg" as "kg" | "lb" }));
vi.mock("@/lib/profile/units-context", () => ({ useUnits: () => ({ unit: units.unit, setUnit: vi.fn() }) }));

const queue = vi.hoisted(() => ({ ops: [] as QueuedOp[], listener: null as null | ((ops: QueuedOp[]) => void) }));
vi.mock("@/lib/offline/client", () => ({
  subscribeToQueue: (listener: (ops: QueuedOp[]) => void) => {
    queue.listener = listener;
    listener(queue.ops);
    return () => {};
  },
}));

const pending = vi.hoisted(() => ({ uploads: [] as { athleteId: string; setId: string }[] }));
vi.mock("@/lib/video/pending-store", () => ({ pendingUploads: async () => pending.uploads }));

// Posters are F12's business and tested there; here a thumbnail is a box.
vi.mock("@/lib/video/poster-cache", () => ({ usePosterUrl: () => null }));

const fetchMyClips = vi.hoisted(() => vi.fn<(request: ClipPageRequest) => Promise<{ clips: ClipSet[]; cursor: string | null }>>());
vi.mock("@/lib/video/my-clips-store", () => ({ fetchMyClips }));

const clip = (id: string, over: Partial<ClipSet> = {}): ClipSet => ({
  id,
  athleteId: "joey",
  exerciseId: "squat",
  sessionId: "s1",
  setIndex: 1,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  e1rmKg: 196,
  loggedAt: "2026-10-06T18:00:00.000Z",
  videoFileId: `file-${id}`,
  videoPosterId: null,
  notes: null,
  isWarmup: false,
  ...over,
});

const grid = () => screen.getByRole("list");
const tiles = () => within(grid()).getAllByRole("link");

beforeEach(() => {
  vi.clearAllMocks();
  units.unit = "kg";
  queue.ops = [];
  pending.uploads = [];
  fetchMyClips.mockResolvedValue({ clips: [], cursor: null });
});

describe("the grid", () => {
  it("shows the athlete's clips newest first, each opening its own screen", async () => {
    fetchMyClips.mockResolvedValue({
      clips: [
        clip("st-2", { loggedAt: new Date(2026, 9, 8, 18, 0).toISOString(), loadKg: 185 }),
        clip("st-1", { exerciseId: "bench", loadKg: 120, reps: 5, rpe: null }),
      ],
      cursor: null,
    });
    render(<ClipsView />);
    await screen.findByRole("list");
    expect(fetchMyClips).toHaveBeenCalledWith({ athleteId: "joey", exerciseId: null });
    const [first, second] = tiles();
    expect(first).toHaveAttribute("href", "/history/clips/st-2");
    expect(first).toHaveAccessibleName(/^Squat, 185 kg × 3 at RPE 8, 8 Oct$/);
    expect(second).toHaveAccessibleName(/^Bench Press, 120 kg × 5, \d+ Oct$/);
    // The thumbnail is decorative: the link already names the clip.
    expect(first.querySelector("[data-clip-thumb]")).toHaveAttribute("aria-hidden", "true");
  });

  it("reads loads in the athlete's unit", async () => {
    units.unit = "lb";
    fetchMyClips.mockResolvedValue({ clips: [clip("st-1", { loadKg: 100 })], cursor: null });
    render(<ClipsView />);
    expect(await screen.findByRole("link")).toHaveTextContent(/220(\.\d)? lb × 3/);
  });

  it("has a real empty state for an athlete who has filmed nothing", async () => {
    render(<ClipsView />);
    expect(await screen.findByText("No clips yet")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter by lift" })).not.toBeInTheDocument();
  });
});

describe("paging", () => {
  it("loads older clips on request, after the cursor it was handed", async () => {
    fetchMyClips
      .mockResolvedValueOnce({ clips: [clip("st-3"), clip("st-2")], cursor: "st-2" })
      .mockResolvedValueOnce({ clips: [clip("st-1")], cursor: null });
    const user = userEvent.setup();
    render(<ClipsView />);
    await screen.findByRole("list");
    expect(tiles()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Load more clips" }));
    await waitFor(() => expect(tiles()).toHaveLength(3));
    expect(fetchMyClips).toHaveBeenLastCalledWith({ athleteId: "joey", exerciseId: null, cursor: "st-2" });
    // That was the last page.
    expect(screen.queryByRole("button", { name: "Load more clips" })).not.toBeInTheDocument();
  });

  it("keeps the grid when a later page fails, and says so", async () => {
    fetchMyClips
      .mockResolvedValueOnce({ clips: [clip("st-2")], cursor: "st-2" })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<ClipsView />);
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Load more clips" }));
    expect(await screen.findByText(/Couldn't load more/)).toBeInTheDocument();
    expect(tiles()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Load more clips" })).toBeEnabled();
  });
});

describe("the lift filter", () => {
  it("offers the filmed lifts and asks the server for the one chosen", async () => {
    fetchMyClips.mockImplementation(async ({ exerciseId }) =>
      exerciseId === "bench"
        ? { clips: [clip("b-old", { exerciseId: "bench" }), clip("b-older", { exerciseId: "bench" })], cursor: null }
        : { clips: [clip("s1"), clip("s2"), clip("b1", { exerciseId: "bench" })], cursor: "b1" },
    );
    const user = userEvent.setup();
    render(<ClipsView />);
    const filter = await screen.findByRole("group", { name: "Filter by lift" });
    expect(within(filter).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Squat", "Bench Press"]);
    expect(within(filter).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(filter).getByRole("button", { name: "Bench Press" }));
    await waitFor(() => expect(tiles()).toHaveLength(2));
    expect(fetchMyClips).toHaveBeenLastCalledWith({ athleteId: "joey", exerciseId: "bench" });
    expect(tiles().map((t) => t.getAttribute("href"))).toEqual(["/history/clips/b-old", "/history/clips/b-older"]);
    // Choosing a lift does not make the others vanish from the row.
    expect(within(filter).getByRole("button", { name: "Squat" })).toBeInTheDocument();
    expect(within(filter).getByRole("button", { name: "Bench Press" })).toHaveAttribute("aria-pressed", "true");

    // Back to All shows what was already loaded, without asking again.
    const calls = fetchMyClips.mock.calls.length;
    await user.click(within(filter).getByRole("button", { name: "All" }));
    expect(tiles()).toHaveLength(3);
    expect(fetchMyClips.mock.calls.length).toBe(calls);
  });

  it("says so when a lift has no clips", async () => {
    fetchMyClips.mockImplementation(async ({ exerciseId }) =>
      exerciseId === "bench"
        ? { clips: [], cursor: null }
        : { clips: [clip("s1"), clip("b1", { exerciseId: "bench" })], cursor: null },
    );
    const user = userEvent.setup();
    render(<ClipsView />);
    await user.click(await screen.findByRole("button", { name: "Bench Press" }));
    expect(await screen.findByRole("status")).toHaveTextContent("No Bench Press clips yet.");
  });
});

describe("offline", () => {
  it("says nothing is lost when the first page cannot load, and retries", async () => {
    fetchMyClips.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({
      clips: [clip("st-1")],
      cursor: null,
    });
    const user = userEvent.setup();
    render(<ClipsView />);
    expect(await screen.findByText("Couldn't load your clips")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list")).toBeInTheDocument();
  });

  it("hides a clip deleted with no signal, and marks one replaced as pending", async () => {
    fetchMyClips.mockResolvedValue({ clips: [clip("gone"), clip("swapped"), clip("kept")], cursor: null });
    render(<ClipsView />);
    await screen.findByRole("list");
    act(() =>
      queue.listener!([
        { id: "o1", kind: "set.attachVideo", payload: { setId: "gone", videoFileId: null }, sequence: 1, attempts: 0, nextAttemptAt: 0 },
        { id: "o2", kind: "set.attachVideo", payload: { setId: "swapped", videoFileId: "file-new" }, sequence: 2, attempts: 0, nextAttemptAt: 0 },
      ]),
    );
    expect(tiles().map((t) => t.getAttribute("href"))).toEqual(["/history/clips/swapped", "/history/clips/kept"]);
    expect(within(tiles()[0]).getByLabelText("Queued, will sync")).toBeInTheDocument();
    expect(within(tiles()[1]).queryByLabelText("Queued, will sync")).not.toBeInTheDocument();
  });

  it("says when clips are still uploading from this phone", async () => {
    pending.uploads = [
      { athleteId: "joey", setId: "st-9" },
      { athleteId: "someone-else", setId: "st-8" },
    ];
    render(<ClipsView />);
    expect(await screen.findByText(/1 clip is still uploading from this phone/)).toBeInTheDocument();
  });
});
