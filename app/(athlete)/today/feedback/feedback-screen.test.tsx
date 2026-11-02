import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackScreen } from "./feedback-screen";
import type { Comment } from "@/lib/review/comments";
import type { FeedbackSet } from "@/lib/review/feedback";
import type { MyCoach } from "@/lib/coach/link-store";
import type { Reaction } from "@/lib/review/reactions";

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
  reactions: [] as Reaction[],
}));

// F25: the one write path a reaction takes, faked so the screen's optimistic
// draw, toggle, replace and revert are what is under test.
const sendReaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/review/reaction-store", () => ({ sendReaction, newReactionId: () => "new-reaction" }));

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
  // 18:00 local on Saturday 19 Sep, whatever TZ the suite runs in. The card
  // shows the athlete's own calendar day; 18:00Z is already Sunday in Auckland.
  loggedAt: new Date(2026, 8, 19, 18, 0).toISOString(),
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
  data.reactions = [];
  fetchFeedback.mockImplementation(async () => {
    if (data.fail) throw new Error("offline");
    return { comments: data.comments, sets: data.sets, reactions: data.reactions };
  });
  sendReaction.mockImplementation(async ({ plan, comment: on }: { plan: { kind: string; emoji?: string }; comment: Comment }) => ({
    ok: true,
    reaction:
      plan.kind === "create"
        ? { id: "new-reaction", commentId: on.id, setId: on.setId, athleteId: on.athleteId, authorId: "joey", emoji: plan.emoji, createdAt: "2026-11-02T09:00:00.000Z" }
        : null,
  }));
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

describe("Coach feedback, reactions (F25)", () => {
  const joeysThumb: Reaction = {
    id: "r1",
    commentId: "c1",
    setId: "set-1",
    athleteId: "joey",
    authorId: "joey",
    emoji: "👍",
    createdAt: "2026-09-20T11:00:00.000Z",
  };

  beforeEach(() => {
    data.comments = [comment({ id: "c1" })];
    data.sets = new Map([["set-1", squat]]);
  });

  it("reacts to the coach's message from a small button, through the write helper's store", async () => {
    const user = userEvent.setup();
    render(<FeedbackScreen />);
    await user.click(await screen.findByRole("button", { name: "React to Ruairi's message" }));
    const picker = screen.getByRole("group", { name: "Reactions" });
    expect(within(picker).getAllByRole("button").map((b) => b.textContent)).toEqual(["👍", "💪", "🔥", "❤️", "😂", "❓"]);
    await user.click(within(picker).getByRole("button", { name: "React strong" }));

    // Drawn at once, highlighted as the athlete's own, before the write lands.
    expect(await screen.findByRole("button", { name: "strong, yours" })).toHaveAttribute("aria-pressed", "true");
    expect(sendReaction).toHaveBeenCalledWith(
      expect.objectContaining({ plan: { kind: "create", emoji: "💪" }, viewerId: "joey", newId: "new-reaction" }),
    );
    expect(screen.queryByRole("group", { name: "Reactions" })).not.toBeInTheDocument();
  });

  it("replaces the athlete's reaction when another emoji is picked", async () => {
    data.reactions = [joeysThumb];
    const user = userEvent.setup();
    render(<FeedbackScreen />);
    await user.click(await screen.findByRole("button", { name: "Change your reaction to Ruairi's message" }));
    await user.click(screen.getByRole("button", { name: "React fire" }));

    expect(await screen.findByRole("button", { name: "fire, yours" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "thumbs up, yours" })).not.toBeInTheDocument();
    expect(sendReaction).toHaveBeenCalledWith(expect.objectContaining({ plan: { kind: "change", rowId: "r1", emoji: "🔥" } }));
  });

  it("takes it back when the athlete taps the one they already left", async () => {
    data.reactions = [joeysThumb];
    const user = userEvent.setup();
    render(<FeedbackScreen />);
    await user.click(await screen.findByRole("button", { name: "thumbs up, yours" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "thumbs up, yours" })).not.toBeInTheDocument());
    expect(sendReaction).toHaveBeenCalledWith(expect.objectContaining({ plan: { kind: "remove", rowId: "r1" } }));
  });

  it("puts it back quietly, with a small line, when the write is refused", async () => {
    data.reactions = [joeysThumb];
    sendReaction.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    render(<FeedbackScreen />);
    await user.click(await screen.findByRole("button", { name: "Change your reaction to Ruairi's message" }));
    await user.click(screen.getByRole("button", { name: "React heart" }));

    expect(await screen.findByRole("status")).toHaveTextContent("That reaction didn't save. Try again.");
    expect(screen.getByRole("button", { name: "thumbs up, yours" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^heart/ })).not.toBeInTheDocument();
  });

  it("offers no reaction on the athlete's own reply, and shows the coach's on it read-only to nobody else", async () => {
    data.comments = [
      comment({ id: "c1" }),
      comment({ id: "c2", authorId: "joey", parentId: "c1", body: "On it.", createdAt: "2026-09-20T11:00:00.000Z" }),
    ];
    data.reactions = [{ ...joeysThumb, id: "r2", commentId: "c2", authorId: "ruairi", emoji: "🔥" }];
    render(<FeedbackScreen />);
    await screen.findByText("On it.");
    // One react button: on Ruairi's message. None on Joey's own.
    expect(screen.getAllByRole("button", { name: /React to|Change your reaction/ })).toHaveLength(1);
    // Ruairi's 🔥 on Joey's reply is shown, and Joey cannot tap it: it is not
    // his to change, and he may not react to his own words.
    expect(screen.getByRole("img", { name: "fire, 1" })).toBeInTheDocument();
  });

  it("keeps the chips and stops new reactions once the coach is unlinked, as with replies", async () => {
    data.coach = null;
    data.reactions = [joeysThumb];
    render(<FeedbackScreen />);
    expect(await screen.findByRole("img", { name: "thumbs up, yours" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /React to/ })).not.toBeInTheDocument();
  });

  it("stays quiet: a coach's reaction newer than the watermark marks nothing New and moves no watermark", async () => {
    // Everything Ruairi SAID was seen; he has reacted since.
    localStorage.setItem("snb.feedback.seenAt.joey", JSON.stringify("2026-09-21T00:00:00.000Z"));
    data.comments = [
      comment({ id: "c1" }),
      comment({ id: "c2", authorId: "joey", parentId: "c1", body: "On it.", createdAt: "2026-09-20T11:00:00.000Z" }),
    ];
    data.reactions = [{ ...joeysThumb, id: "late", commentId: "c2", authorId: "ruairi", emoji: "❤️", createdAt: "2026-09-25T09:00:00.000Z" }];
    render(<FeedbackScreen />);
    expect(await screen.findByRole("img", { name: "heart, 1" })).toBeInTheDocument();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(markSeen).toHaveBeenCalledWith("2026-09-21T00:00:00.000Z");
  });

  it("opens the picker on a long press of the message, on a touch screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<FeedbackScreen />);
      const words = await screen.findByText("Hips shot up on rep two.");
      const { fireEvent, act } = await import("@testing-library/react");
      fireEvent.pointerDown(words, { pointerType: "touch", clientX: 10, clientY: 10 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByRole("group", { name: "Reactions" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
