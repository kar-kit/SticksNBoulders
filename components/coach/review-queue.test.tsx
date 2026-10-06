import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewQueue } from "./review-queue";
import type { ClipSet } from "@/lib/review/queue";

/**
 * Order 16.6 on the Review Queue: an athlete unlinking is a normal state. Their
 * clips leave with a reason, nothing on screen errors, and a re-link puts them
 * back. The queue's own behaviour (ordering, advancing) is tested in
 * lib/review/queue.test.ts; this covers only what a revoked link does to it.
 */

const session = vi.hoisted(() => ({ athleteIds: ["joey", "sam"], refresh: vi.fn() }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: {
      status: "signed-in",
      user: { id: "coach", name: "Ruairi Deane", email: "r@example.com" },
      coach: { isCoach: true, athleteIds: session.athleteIds },
    },
    refresh: session.refresh,
  }),
}));

const role = vi.hoisted(() => ({ fetchCoachStatus: vi.fn() }));
vi.mock("@/lib/auth/role", () => role);

vi.mock("@/lib/auth/athletes", () => ({
  fetchAthleteNames: async (ids: string[]) =>
    ids.map((id) => ({ id, name: id === "joey" ? "Joey Pang" : "Sam Tierney" })),
}));

let onLinkChange: () => void = () => {};
vi.mock("@/lib/coach/coach-links-store", () => ({
  subscribeToLinks: (_db: string, cb: () => void) => {
    onLinkChange = cb;
    return () => {};
  },
}));

vi.mock("@/appwrite/browser-client", () => ({ browserAppwrite: () => ({ databaseId: "db" }) }));

const clip = (id: string, athleteId: string, loggedAt: string): ClipSet => ({
  id,
  athleteId,
  exerciseId: `ex-${id}`,
  sessionId: `sess-${id}`,
  setIndex: 1,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  e1rmKg: 200,
  loggedAt,
  videoFileId: `file-${id}`,
  notes: null,
});

const ALL = [
  clip("joey-1", "joey", "2026-09-20T10:00:00.000Z"),
  clip("joey-2", "joey", "2026-09-21T10:00:00.000Z"),
  clip("sam-1", "sam", "2026-09-22T10:00:00.000Z"),
];

const queueStore = vi.hoisted(() => ({
  fetchClips: vi.fn(),
  fetchReviewedSetIds: vi.fn(),
  fetchExerciseNames: vi.fn(),
  fetchSessionSets: vi.fn(),
  fetchRecentSets: vi.fn(),
  fetchClipUrls: vi.fn(),
  clearClip: vi.fn(),
  restoreClip: vi.fn(),
  subscribeToClips: vi.fn(),
}));
vi.mock("@/lib/review/queue-store", () => queueStore);

const commentStore = vi.hoisted(() => ({ fetchCommentsForSets: vi.fn(), submitComment: vi.fn() }));
vi.mock("@/lib/review/comment-store", () => commentStore);

let linked: string[] = [];

beforeEach(() => {
  linked = ["joey", "sam"];
  session.athleteIds = ["joey", "sam"];
  session.refresh.mockResolvedValue(undefined);
  role.fetchCoachStatus.mockImplementation(async () => ({ isCoach: linked.length > 0, athleteIds: [...linked] }));
  // The instance filters by permission: a coach who left the circle simply
  // gets fewer rows back, never an error.
  queueStore.fetchClips.mockImplementation(async (ids: string[]) => ALL.filter((c) => ids.includes(c.athleteId)));
  queueStore.fetchReviewedSetIds.mockResolvedValue(new Set());
  queueStore.fetchExerciseNames.mockImplementation(
    async (ids: string[]) => new Map(ids.map((id) => [id, id.includes("sam") ? "Bench Press" : "Squat"])),
  );
  queueStore.fetchSessionSets.mockResolvedValue([]);
  queueStore.fetchRecentSets.mockResolvedValue([]);
  queueStore.fetchClipUrls.mockResolvedValue(new Map());
  queueStore.clearClip.mockResolvedValue(undefined);
  queueStore.subscribeToClips.mockReturnValue(() => {});
  commentStore.fetchCommentsForSets.mockResolvedValue([]);
});

it("reads who is linked fresh, so a stale session never lists an ex-athlete's clips", async () => {
  linked = ["sam"]; // Joey unlinked after the app loaded.
  render(<ReviewQueue />);
  expect(await screen.findByText("1 waiting")).toBeInTheDocument();
  expect(queueStore.fetchClips).toHaveBeenCalledWith(["sam"]);
  expect(screen.queryByText("Joey Pang")).not.toBeInTheDocument();
  // The rail and badge read the session, so it is corrected too.
  expect(session.refresh).toHaveBeenCalled();
});

it("drops an athlete's clips live when they unlink, and says why", async () => {
  render(<ReviewQueue />);
  expect(await screen.findByText("3 waiting")).toBeInTheDocument();

  linked = ["sam"];
  act(() => onLinkChange());

  expect(await screen.findByText("1 waiting")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "2 clips left the queue because the athletes who filmed them are no longer linked with you.",
  );
  expect(screen.queryByText(/would not load/)).not.toBeInTheDocument();
});

it("flushes a half-written comment on a clip that left", async () => {
  render(<ReviewQueue />);
  const box = await screen.findByRole("textbox");
  await userEvent.type(box, "Knees caving on the way up");

  linked = ["sam"];
  act(() => onLinkChange());

  await screen.findByText("1 waiting");
  expect(screen.getByRole("textbox")).toHaveValue("");
});

it("treats a refused comment as a possible unlink and re-reads", async () => {
  render(<ReviewQueue />);
  const box = await screen.findByRole("textbox");
  await userEvent.type(box, "Brace harder");

  // The athlete unlinked a moment ago and realtime has not said so yet.
  linked = ["sam"];
  commentStore.submitComment.mockResolvedValue({ ok: false, reason: "failed" });
  await userEvent.keyboard("{Control>}{Enter}{/Control}");

  expect(await screen.findByText("1 waiting")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/left the queue/);
});

it("shows the reason on the empty screen when the last athlete leaves", async () => {
  linked = ["joey"];
  session.athleteIds = ["joey"];
  render(<ReviewQueue />);
  await screen.findByText("2 waiting");

  linked = [];
  act(() => onLinkChange());

  expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/2 clips left the queue/);
});

it("puts the clips back on re-link and clears the notice", async () => {
  render(<ReviewQueue />);
  await screen.findByText("3 waiting");

  linked = ["sam"];
  act(() => onLinkChange());
  await screen.findByText("1 waiting");

  linked = ["joey", "sam"];
  act(() => onLinkChange());
  expect(await screen.findByText("3 waiting")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
});
