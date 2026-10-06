import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackScreen } from "./feedback-screen";
import type { Comment } from "@/lib/review/comments";
import type { FeedbackSet } from "@/lib/review/feedback";
import type { MyCoach } from "@/lib/coach/link-store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

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
      exercises: [{ id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true }],
    },
  }),
}));

const data = vi.hoisted(() => ({
  comments: [] as Comment[],
  sets: new Map<string, FeedbackSet>(),
  coach: null as MyCoach | null,
  pending: [] as { athleteId: string; setId: string }[],
  fail: false,
}));

const fetchFeedback = vi.hoisted(() => vi.fn());
vi.mock("@/lib/review/feedback-store", () => ({ fetchFeedback }));

const fetchClipUrls = vi.hoisted(() => vi.fn());
vi.mock("@/lib/review/queue-store", () => ({ fetchClipUrls }));

vi.mock("@/lib/coach/link-store", () => ({ fetchMyCoach: async () => data.coach }));
vi.mock("@/lib/video/pending-store", () => ({ pendingUploads: async () => data.pending }));

const submitComment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/review/comment-store", () => ({ submitComment }));

const markSeen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/review/feedback-context", () => ({
  useFeedbackBadge: () => ({ hasCoach: true, unread: 0, seenAt: null, markSeen, refresh: vi.fn() }),
}));

const RUAIRI: MyCoach = { coachId: "ruairi", coachName: "Ruairi", linkedAt: null };

const comment = (overrides: Partial<Comment> & Pick<Comment, "id">): Comment => ({
  setId: "set-1",
  athleteId: "joey",
  authorId: "ruairi",
  body: "Hips shot up on rep two.",
  parentId: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  ...overrides,
});

const squat: FeedbackSet = {
  id: "set-1",
  sessionId: "session-1",
  exerciseId: "squat",
  setIndex: 2,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  isWarmup: false,
  loggedAt: "2026-09-19T18:00:00.000Z",
  videoFileId: "clip-1",
  notes: "felt heavy",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  data.comments = [];
  data.sets = new Map();
  data.coach = RUAIRI;
  data.pending = [];
  data.fail = false;
  fetchFeedback.mockImplementation(async () => {
    if (data.fail) throw new Error("offline");
    return { comments: data.comments, sets: data.sets };
  });
  fetchClipUrls.mockImplementation(
    async (ids: string[]) => new Map(ids.map((id) => [id, `/api/clip/${id}?t=ticket`])),
  );
});

describe("Coach feedback, empty", () => {
  it("tells a solo athlete there is no coach, and where to add one", async () => {
    data.coach = null;
    render(<FeedbackScreen />);
    expect(await screen.findByText("No coach linked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a coach in Me" })).toHaveAttribute("href", "/me");
  });

  it("nudges toward filming when the coach has not said anything yet", async () => {
    render(<FeedbackScreen />);
    expect(await screen.findByText("Nothing from Ruairi yet")).toBeInTheDocument();
    expect(screen.getByText("Film a set and Ruairi will see it.")).toBeInTheDocument();
  });

  it("says so, with a retry, when the read fails", async () => {
    data.fail = true;
    render(<FeedbackScreen />);
    expect(await screen.findByText("Couldn't load your feedback")).toBeInTheDocument();
    data.fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing from Ruairi yet")).toBeInTheDocument();
  });
});

describe("Coach feedback, with comments", () => {
  beforeEach(() => {
    data.comments = [comment({ id: "c1" })];
    data.sets = new Map([["set-1", squat]]);
  });

  it("shows the set's numbers beside what the coach said", async () => {
    render(<FeedbackScreen />);
    const card = await screen.findByRole("article");
    expect(within(card).getByText(/Squat · Sat 19 Sept? · Set 2/)).toBeInTheDocument();
    expect(within(card).getByText(/180 kg × 3/)).toBeInTheDocument();
    expect(within(card).getByText("RPE 8")).toBeInTheDocument();
    expect(within(card).getByText("Hips shot up on rep two.")).toBeInTheDocument();
    expect(within(card).getByText(/Ruairi/)).toBeInTheDocument();
    expect(within(card).getByText("Your note: “felt heavy”")).toBeInTheDocument();
  });

  it("opens the set in its session", async () => {
    render(<FeedbackScreen />);
    const link = await screen.findByRole("link", { name: /in its session/ });
    expect(link).toHaveAttribute("href", "/history/session-1");
  });

  it("plays the clip through one batch of tickets, not one request per card", async () => {
    data.comments = [comment({ id: "c1" }), comment({ id: "c2", setId: "set-2" })];
    data.sets = new Map([
      ["set-1", squat],
      ["set-2", { ...squat, id: "set-2", videoFileId: "clip-2" }],
    ]);
    render(<FeedbackScreen />);
    await waitFor(() => expect(screen.getAllByLabelText(/^Clip of/)).toHaveLength(2));
    expect(fetchFeedback).toHaveBeenCalledTimes(1);
    expect(fetchClipUrls).toHaveBeenCalledTimes(1);
    expect(fetchClipUrls.mock.calls[0][0]).toEqual(expect.arrayContaining(["clip-1", "clip-2"]));
  });

  it("marks what is new on this visit, and records it as seen", async () => {
    render(<FeedbackScreen />);
    expect(await screen.findByText("New")).toBeInTheDocument();
    expect(markSeen).toHaveBeenCalledWith("2026-09-20T10:00:00.000Z");
  });

  it("does not mark what was already seen", async () => {
    localStorage.setItem("snb.feedback.seenAt.joey", JSON.stringify("2026-09-21T00:00:00.000Z"));
    render(<FeedbackScreen />);
    await screen.findByRole("article");
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("replies in the thread, through the write helper", async () => {
    submitComment.mockImplementation(async (request: { body: string; parentId: string }) => ({
      ok: true,
      comment: comment({
        id: "r1",
        authorId: "joey",
        body: request.body,
        parentId: request.parentId,
        createdAt: "2026-09-20T12:00:00.000Z",
      }),
    }));
    const user = userEvent.setup();
    render(<FeedbackScreen />);
    const box = await screen.findByRole("textbox", { name: /Reply about Squat/ });
    await user.type(box, "Felt it. Dropping to 170.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(submitComment).toHaveBeenCalledWith({
      athleteId: "joey",
      setId: "set-1",
      authorId: "joey",
      body: "Felt it. Dropping to 170.",
      parentId: "c1",
    });
    expect(await screen.findByText("Felt it. Dropping to 170.")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("keeps the draft when the reply does not send", async () => {
    submitComment.mockResolvedValue({ ok: false, reason: "failed" });
    const user = userEvent.setup();
    render(<FeedbackScreen />);
    const box = await screen.findByRole("textbox", { name: /Reply about/ });
    await user.type(box, "On it");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/didn't send/)).toBeInTheDocument();
    expect(box).toHaveValue("On it");
  });

  it("turns replies off once the coach is unlinked, and keeps what they said", async () => {
    data.coach = null;
    render(<FeedbackScreen />);
    expect(await screen.findByText("Hips shot up on rep two.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/replies are off/)).toBeInTheDocument();
  });
});

describe("Coach feedback, a long season", () => {
  it("asks for clip tickets in batches the clip route accepts", async () => {
    data.comments = Array.from({ length: 70 }, (_, i) => comment({ id: `c${i}`, setId: `s${i}` }));
    data.sets = new Map(data.comments.map((c, i) => [c.setId, { ...squat, id: c.setId, videoFileId: `clip-${i}` }]));
    render(<FeedbackScreen />);
    await waitFor(() => expect(fetchClipUrls).toHaveBeenCalledTimes(2));
    expect(fetchClipUrls.mock.calls.map((call) => call[0].length)).toEqual([50, 20]);
    expect(fetchFeedback).toHaveBeenCalledTimes(1);
  });
});

describe("Coach feedback, a clip still uploading", () => {
  it("shows the set with a pending mark so the athlete knows the coach cannot see it yet", async () => {
    data.pending = [{ athleteId: "joey", setId: "set-1" }];
    data.sets = new Map([["set-1", squat]]);
    render(<FeedbackScreen />);
    const section = await screen.findByRole("region", { name: "Still uploading" });
    expect(within(section).getByText(/Ruairi can't see it yet/)).toBeInTheDocument();
    expect(fetchFeedback).toHaveBeenCalledWith("joey", ["set-1"]);
  });
});
