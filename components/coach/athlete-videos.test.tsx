import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AthleteVideos } from "./athlete-videos";

const queue = vi.hoisted(() => ({
  fetchClips: vi.fn(),
  fetchClipUrls: vi.fn(),
  fetchReviews: vi.fn(),
  clearClip: vi.fn(),
  restoreClip: vi.fn(),
}));
vi.mock("@/lib/review/queue-store", () => queue);

const comments = vi.hoisted(() => ({ fetchCommentsForSets: vi.fn(), submitComment: vi.fn() }));
vi.mock("@/lib/review/comment-store", () => comments);

const replies = vi.hoisted(() => {
  const markRead = vi.fn();
  return { markRead, useMarkThreadRead: vi.fn(), useCoachReplies: () => ({ markRead }) };
});
vi.mock("@/lib/review/coach-replies-context", () => replies);

const library = vi.hoisted(() => ({ fetchExerciseLibrary: vi.fn() }));
vi.mock("@/lib/exercises/library", () => library);

const linkState = vi.hoisted(() => ({ athleteIds: ["joey"] as string[] }));
vi.mock("@/lib/auth/session-context", () => ({
  useSession: () => ({
    state: { status: "signed-in", user: { id: "coach", name: "Ruairi", email: "" }, coach: { isCoach: true, athleteIds: linkState.athleteIds } },
    refresh: vi.fn(),
  }),
}));

const clip = (id: string, exerciseId: string, loggedAt: string, over: Record<string, unknown> = {}) => ({
  id,
  athleteId: "joey",
  exerciseId,
  sessionId: "s1",
  setIndex: 0,
  loadKg: exerciseId === "bench" ? 120 : 180,
  reps: exerciseId === "bench" ? 5 : 3,
  rpe: 8,
  e1rmKg: null,
  loggedAt,
  videoFileId: `file-${id}`,
  notes: null,
  ...over,
});

const said = (id: string, setId: string, authorId: string, body: string, createdAt: string, parentId: string | null = null) => ({
  id,
  setId,
  athleteId: "joey",
  authorId,
  body,
  parentId,
  createdAt,
});

beforeEach(() => {
  queue.fetchClips.mockResolvedValue([
    clip("squat-clip", "squat", "2026-10-12T10:00:00Z", { notes: "Knee felt fine" }),
    clip("bench-clip", "bench", "2026-10-14T10:00:00Z"),
  ]);
  queue.fetchReviews.mockResolvedValue(new Map([["bench-clip", "file-bench-clip"]]));
  linkState.athleteIds = ["joey"];
  replies.markRead.mockReset();
  comments.submitComment.mockReset();
  queue.fetchClipUrls.mockReset();
  queue.fetchClipUrls.mockResolvedValue(new Map([["file-bench-clip", "/api/clip/file-bench-clip?t=x"]]));
  comments.fetchCommentsForSets.mockResolvedValue([
    said("c1", "bench-clip", "coach", "Tuck the elbows.", "2026-10-14T12:00:00Z"),
    said("c2", "bench-clip", "joey", "Got it, felt it too.", "2026-10-14T13:00:00Z", "c1"),
  ]);
  library.fetchExerciseLibrary.mockResolvedValue([
    { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true, ownerId: null },
    { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true, ownerId: null },
  ]);
});

const props = { athleteId: "joey", athleteName: "Joey Pang", openClipId: null, onOpen: vi.fn(), onClose: vi.fn() };

describe("the list", () => {
  it("is one compact button per clip, newest first, with the lift, the load and whether it is reviewed", async () => {
    render(<AthleteVideos {...props} />);
    const bench = await screen.findByRole("button", { name: /Bench Press/ });
    const squat = screen.getByRole("button", { name: /Squat/ });
    expect(bench).toHaveTextContent("14 Oct");
    expect(bench).toHaveTextContent("120 × 5 @8");
    expect(bench).toHaveTextContent("reviewed · 2 comments");
    expect(squat).toHaveTextContent("waiting");
    expect(screen.getAllByRole("button", { name: /×/ })).toEqual([bench, squat]);
  });

  it("plays nothing on the page", async () => {
    const { container } = render(<AthleteVideos {...props} />);
    await screen.findByRole("button", { name: /Bench Press/ });
    expect(container.querySelector("video")).toBeNull();
    expect(queue.fetchClipUrls).not.toHaveBeenCalled();
  });

  it("carries the latest feedback on the clip it is about, under who said it", async () => {
    render(<AthleteVideos {...props} />);
    const bench = await screen.findByRole("button", { name: /Bench Press/ });
    expect(bench).toHaveTextContent("Joey Pang: Got it, felt it too.");
    expect(screen.getByRole("button", { name: /Squat/ })).not.toHaveTextContent(":");
  });

  it("asks for a clip to be opened rather than opening it itself", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AthleteVideos {...props} onOpen={onOpen} />);
    await user.click(await screen.findByRole("button", { name: /Bench Press/ }));
    expect(onOpen).toHaveBeenCalledWith("bench-clip");
  });
});

describe("an opened clip", () => {
  it("marks its thread read for the coach's Replies, as far as the dialog shows (F26)", async () => {
    render(<AthleteVideos {...props} openClipId="bench-clip" />);
    await screen.findByRole("dialog");
    const [setId, shown] = replies.useMarkThreadRead.mock.lastCall!;
    expect(setId).toBe("bench-clip");
    expect((shown as { setId: string }[]).every((c) => c.setId === "bench-clip")).toBe(true);
    expect(shown).not.toHaveLength(0);
  });

  it("shows the review queue's player and the whole thread together", async () => {
    render(<AthleteVideos {...props} openClipId="bench-clip" />);
    const dialog = await screen.findByRole("dialog", { name: /Bench Press 120 × 5 @8/ });
    await waitFor(() => expect(dialog.querySelector("video")).toHaveAttribute("src", "/api/clip/file-bench-clip?t=x"));
    expect(within(dialog).getByRole("group", { name: "Playback speed" })).toBeInTheDocument();
    expect(within(dialog).getByText("Already said")).toBeInTheDocument();
    expect(within(dialog).getByText("Tuck the elbows.")).toBeInTheDocument();
    expect(within(dialog).getByText("Got it, felt it too.")).toBeInTheDocument();
    expect(within(dialog).getByText(/^Joey Pang/)).toBeInTheDocument();
    expect(queue.fetchClipUrls).toHaveBeenCalledWith(["file-bench-clip"]);
  });

  it("points a waiting clip at the Review queue, where commenting happens", async () => {
    render(<AthleteVideos {...props} openClipId="squat-clip" />);
    const dialog = await screen.findByRole("dialog", { name: /Squat/ });
    expect(within(dialog).getByRole("link", { name: /Review/ })).toHaveAttribute("href", "/coach/review");
    expect(within(dialog).getByText("Nothing said on this clip yet.")).toBeInTheDocument();
    expect(within(dialog).getByText("“Knee felt fine”")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Athlete note" })).toBeInTheDocument();
  });

  it("marks a clip the athlete left a note on in the list, and only that one (F11)", async () => {
    render(<AthleteVideos {...props} />);
    const bench = await screen.findByRole("button", { name: /Bench Press/ });
    expect(screen.getByRole("button", { name: /Squat/ })).toHaveTextContent("their note");
    expect(bench).not.toHaveTextContent("their note");
  });

  it("closes through the caller", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AthleteVideos {...props} openClipId="bench-clip" onClose={onClose} />);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens nothing for an id that is not one of this athlete's clips", async () => {
    render(<AthleteVideos {...props} openClipId="somebody-elses" />);
    await screen.findByRole("button", { name: /Bench Press/ });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("answering on a reviewed clip (F26 follow-up)", () => {
  it("gives a reviewed clip the queue's comment box, without Skip", async () => {
    render(<AthleteVideos {...props} openClipId="bench-clip" />);
    const dialog = await screen.findByRole("dialog", { name: /Bench Press/ });
    expect(within(dialog).getByRole("textbox", { name: "Your comment" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    // The thread is still there, above the box.
    expect(within(dialog).getByText("Got it, felt it too.")).toBeInTheDocument();
  });

  it("keeps a waiting clip pointed at Review, with no box", async () => {
    render(<AthleteVideos {...props} openClipId="squat-clip" />);
    const dialog = await screen.findByRole("dialog", { name: /Squat/ });
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("posts a normal coach comment under the athlete's thread, never touches the review, and marks the thread read", async () => {
    const user = userEvent.setup();
    comments.submitComment.mockImplementation(async (request: Record<string, unknown>) => ({
      ok: true,
      comment: { id: "c3", setId: request.setId, athleteId: request.athleteId, authorId: request.authorId, body: request.body, parentId: request.parentId, createdAt: "2026-10-15T09:00:00Z" },
    }));
    render(<AthleteVideos {...props} openClipId="bench-clip" />);
    const dialog = await screen.findByRole("dialog", { name: /Bench Press/ });
    await user.type(within(dialog).getByRole("textbox", { name: "Your comment" }), "Yes, keep them tucked.");
    await user.click(within(dialog).getByRole("button", { name: "Reply" }));

    expect(comments.submitComment).toHaveBeenCalledWith({
      athleteId: "joey",
      setId: "bench-clip",
      authorId: "coach",
      body: "Yes, keep them tucked.",
      parentId: "c1",
    });
    // The clip stays cleared: no review written, none removed.
    expect(queue.clearClip).not.toHaveBeenCalled();
    expect(queue.restoreClip).not.toHaveBeenCalled();
    // Read through what he had on screen when he answered.
    expect(replies.markRead).toHaveBeenCalledWith("bench-clip", [
      expect.objectContaining({ id: "c1" }),
      expect.objectContaining({ id: "c2" }),
    ]);
    expect(await within(dialog).findByText("Yes, keep them tucked.")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Your comment" })).toHaveValue("");
    expect(within(dialog).getByText("Reviewed")).toBeInTheDocument();
  });

  it("keeps the draft and marks nothing when the post is refused", async () => {
    const user = userEvent.setup();
    comments.submitComment.mockResolvedValue({ ok: false, reason: "failed" });
    render(<AthleteVideos {...props} openClipId="bench-clip" />);
    const dialog = await screen.findByRole("dialog", { name: /Bench Press/ });
    await user.type(within(dialog).getByRole("textbox", { name: "Your comment" }), "Lighter next week.");
    await user.click(within(dialog).getByRole("button", { name: "Reply" }));
    expect(await within(dialog).findByText(/didn't send/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Your comment" })).toHaveValue("Lighter next week.");
    expect(replies.markRead).not.toHaveBeenCalled();
  });

  it("shows no box once the athlete is no longer linked to this coach", async () => {
    linkState.athleteIds = [];
    render(<AthleteVideos {...props} openClipId="bench-clip" />);
    const dialog = await screen.findByRole("dialog", { name: /Bench Press/ });
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Got it, felt it too.")).toBeInTheDocument();
  });
});
