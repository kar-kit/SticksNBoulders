import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipDetail } from "./clip-detail";
import type { ClipSet } from "@/lib/review/queue";
import type { Comment } from "@/lib/review/comments";
import type { MyCoach } from "@/lib/coach/link-store";

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
    state: { status: "ready", exercises: [{ id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true }] },
  }),
}));

vi.mock("@/lib/profile/units-context", () => ({ useUnits: () => ({ unit: "kg", setUnit: vi.fn() }) }));
vi.mock("@/lib/offline/client", () => ({ subscribeToQueue: () => () => {} }));

const data = vi.hoisted(() => ({
  clip: null as ClipSet | null,
  comments: [] as Comment[],
  coach: null as MyCoach | null,
  failRead: false,
}));

const store = vi.hoisted(() => ({
  fetchMyClip: vi.fn(),
  deleteMyClip: vi.fn(async () => {}),
  retireReplacedClip: vi.fn(async () => {}),
}));
vi.mock("@/lib/video/my-clips-store", () => store);

const comments = vi.hoisted(() => ({ fetchCommentsForSets: vi.fn(), submitComment: vi.fn() }));
vi.mock("@/lib/review/comment-store", () => comments);

const fetchClipUrls = vi.hoisted(() => vi.fn(async (ids: readonly string[]) => new Map(ids.map((id) => [id, `/api/clip/${id}?t=x`]))));
vi.mock("@/lib/review/queue-store", () => ({ fetchClipUrls }));

vi.mock("@/lib/coach/link-store", () => ({ fetchMyCoach: async () => data.coach }));

const editSet = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/logging/set-store", () => ({ editSet }));

const attachClipToSet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/video/upload", () => ({ attachClipToSet }));

const badge = vi.hoisted(() => ({ markSetSeen: vi.fn() }));
vi.mock("@/lib/review/feedback-context", () => ({ useFeedbackBadge: () => badge }));

const haptic = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/ui/haptics", () => ({ haptic }));

const RUAIRI: MyCoach = { coachId: "ruairi", coachName: "Ruairi", linkedAt: null };

const squat = (over: Partial<ClipSet> = {}): ClipSet => ({
  id: "st-1",
  athleteId: "joey",
  exerciseId: "squat",
  sessionId: "session-1",
  setIndex: 2,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  e1rmKg: 196,
  loggedAt: new Date(2026, 9, 6, 18, 0).toISOString(),
  videoFileId: "file-a",
  videoPosterId: null,
  notes: "left hip pinched",
  isWarmup: false,
  ...over,
});

const comment = (id: string, over: Partial<Comment> = {}): Comment => ({
  id,
  setId: "st-1",
  athleteId: "joey",
  authorId: "ruairi",
  body: "Hips shot up on rep two.",
  parentId: null,
  createdAt: "2026-10-06T20:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  data.clip = squat();
  data.comments = [];
  data.coach = RUAIRI;
  data.failRead = false;
  store.fetchMyClip.mockImplementation(async () => {
    if (data.failRead) throw new TypeError("Failed to fetch");
    return data.clip;
  });
  comments.fetchCommentsForSets.mockImplementation(async () => data.comments);
  comments.submitComment.mockImplementation(async (request: { body: string; parentId: string | null }) => ({
    ok: true,
    comment: comment("new", { authorId: "joey", body: request.body, parentId: request.parentId }),
  }));
});

const open = async () => {
  const view = render(<ClipDetail setId="st-1" />);
  await screen.findByRole("heading", { level: 1, name: /Squat/ });
  return { ...view, user: userEvent.setup() };
};

describe("what it shows", () => {
  it("the clip, its set, the athlete's note and the coach's thread", async () => {
    data.comments = [comment("c1")];
    const { container } = await open();
    expect(store.fetchMyClip).toHaveBeenCalledWith("joey", "st-1");
    // The player, on a ticket minted for this clip only.
    await waitFor(() => expect(container.querySelector("video")).toHaveAttribute("src", "/api/clip/file-a?t=x"));
    expect(fetchClipUrls).toHaveBeenCalledWith(["file-a"]);
    expect(screen.getByRole("group", { name: "Playback speed" })).toBeInTheDocument();
    // The set, linking to its session.
    const set = screen.getByRole("link", { name: /Open the session/ });
    expect(set).toHaveAttribute("href", "/history/session-1");
    expect(set).toHaveTextContent("180 kg × 3");
    expect(set).toHaveTextContent("RPE 8");
    expect(set).toHaveTextContent(/Set 2/);
    expect(screen.getByText("left hip pinched")).toBeInTheDocument();
    // The coach, by name, in the coach's own thread component.
    expect(await screen.findByText("Hips shot up on rep two.")).toBeInTheDocument();
    expect(screen.getByText("Ruairi")).toBeInTheDocument();
  });

  it("calls an unnamed coach 'Your coach', not 'Your athlete'", async () => {
    data.coach = undefined as unknown as MyCoach;
    data.comments = [comment("c1")];
    await open();
    expect(await screen.findByText("Your coach")).toBeInTheDocument();
    expect(screen.queryByText("Your athlete")).not.toBeInTheDocument();
  });

  it("refuses a set that is not the athlete's own, and never mints a ticket for it", async () => {
    // fetchMyClip reads null for anyone else's set, however readable.
    data.clip = null;
    render(<ClipDetail setId="st-sams" />);
    expect(await screen.findByText("This clip isn't here")).toBeInTheDocument();
    expect(fetchClipUrls).not.toHaveBeenCalled();
    expect(document.querySelector("video")).toBeNull();
  });

  it("says nothing is lost when it cannot load, and tries again", async () => {
    data.failRead = true;
    render(<ClipDetail setId="st-1" />);
    expect(await screen.findByText("Couldn't load this clip")).toBeInTheDocument();
    data.failRead = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Squat/ })).toBeInTheDocument();
  });
});

describe("replying", () => {
  it("answers the coach's latest thread, and shows the reply at once", async () => {
    data.comments = [comment("c1", { createdAt: "2026-10-06T20:00:00.000Z" }), comment("c2", { createdAt: "2026-10-07T20:00:00.000Z", body: "Brace harder." })];
    const { user } = await open();
    const box = await screen.findByRole("textbox", { name: /Reply about Squat/ });
    await user.type(box, "Will do, felt it too");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(comments.submitComment).toHaveBeenCalledWith({
      athleteId: "joey",
      setId: "st-1",
      authorId: "joey",
      body: "Will do, felt it too",
      parentId: "c2",
    });
    expect(await screen.findByText("Will do, felt it too")).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("keeps the draft when the reply does not send", async () => {
    data.comments = [comment("c1")];
    comments.submitComment.mockResolvedValueOnce({ ok: false, reason: "failed" });
    const { user } = await open();
    const box = await screen.findByRole("textbox", { name: /Reply about/ });
    await user.type(box, "hm");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/didn't send/)).toBeInTheDocument();
    expect(box).toHaveValue("hm");
  });

  it("offers no reply box until the coach has said something", async () => {
    await open();
    expect(await screen.findByText(/Nothing on this clip yet/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Reply/ })).not.toBeInTheDocument();
  });

  it("turns replies off once there is no coach to read them", async () => {
    data.coach = null;
    data.comments = [comment("c1")];
    await open();
    expect(await screen.findByText(/replies are off/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Reply/ })).not.toBeInTheDocument();
  });
});

describe("the note", () => {
  it("is edited through editSet, restating the set as it stands -- warm-up flag included", async () => {
    data.clip = squat({ isWarmup: true, rpe: null, setIndex: 0, notes: null });
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Add a note" }));
    await user.type(screen.getByRole("textbox", { name: "Note on Warm-up set" }), "  bar path drifted  ");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(editSet).toHaveBeenCalledWith(
      "st-1",
      { loadKg: 180, reps: 3, rpe: null, isWarmup: true, failed: false, notes: "bar path drifted" },
      { exerciseId: "squat", loggedAt: new Date(data.clip!.loggedAt) },
    );
    expect(await screen.findByText("bar path drifted")).toBeInTheDocument();
  });

  it("clears a note emptied out", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Edit your note" }));
    await user.clear(screen.getByRole("textbox", { name: "Note on Set 2" }));
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(editSet).toHaveBeenCalledWith("st-1", expect.objectContaining({ notes: null, isWarmup: false }), expect.anything());
    expect(await screen.findByText("No note on this set.")).toBeInTheDocument();
  });
});

describe("deleting the clip", () => {
  it("asks first, says what stays, then deletes the clip and its file and goes back to the grid", async () => {
    data.comments = [comment("c1")];
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Delete clip" }));
    const confirm = screen.getByRole("group", { name: /Delete this clip\?/ });
    expect(confirm).toHaveTextContent("The set stays in your log, and your coach's comments stay on it.");
    expect(store.deleteMyClip).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Delete clip" }));
    expect(haptic).toHaveBeenCalledWith("warning");
    expect(store.deleteMyClip).toHaveBeenCalledWith("st-1", "file-a");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/history?view=clips"));
  });

  it("waits while a replacement is uploading: deleting then would be undone when it attached", async () => {
    let finish: (value: unknown) => void = () => {};
    attachClipToSet.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { user, container } = await open();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(["x"], "again.mov", { type: "video/quicktime" }));
    expect(screen.getByRole("button", { name: "Delete clip" })).toBeDisabled();
    finish({ ok: true, fileId: "file-b" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete clip" })).toBeEnabled());
  });

  it("can be called off", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Delete clip" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(store.deleteMyClip).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /Delete this clip\?/ })).not.toBeInTheDocument();
  });

  it("stays put and says so when the phone could not store the delete", async () => {
    store.deleteMyClip.mockRejectedValueOnce(new Error("quota"));
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Delete clip" }));
    await user.click(within(screen.getByRole("group", { name: /Delete this clip\?/ })).getByRole("button", { name: "Delete clip" }));
    expect(await screen.findByText(/wasn't deleted/)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("the keyboard", () => {
  it("leaves Space to the focused button: the player takes no window-wide keys here", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { user, container } = await open();
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    screen.getByRole("button", { name: "Delete clip" }).focus();
    await user.keyboard(" ");
    expect(screen.getByRole("group", { name: /Delete this clip\?/ })).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
    // Nor does it promise keys it does not take.
    expect(screen.queryByText(/Space plays/)).not.toBeInTheDocument();
  });
});

describe("replacing the clip", () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, container: HTMLElement) => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new File(["x"], "again.mov", { type: "video/quicktime" }));
  };

  it("uploads through the Log's own attach path, then retires the old file and plays the new one", async () => {
    attachClipToSet.mockResolvedValue({ ok: true, fileId: "file-b" });
    const { user, container } = await open();
    expect(screen.getByRole("button", { name: "Replace video" })).toBeInTheDocument();
    await pick(user, container);
    expect(attachClipToSet).toHaveBeenCalledWith("st-1", "joey", expect.any(File), expect.anything());
    await waitFor(() => expect(store.retireReplacedClip).toHaveBeenCalledWith("st-1", "file-a"));
    await waitFor(() => expect(fetchClipUrls).toHaveBeenCalledWith(["file-b"]));
  });

  it("keeps the old clip when the new one is still uploading", async () => {
    attachClipToSet.mockResolvedValue({ ok: false, reason: "pending", message: "It will carry on by itself." });
    const { user, container } = await open();
    await pick(user, container);
    expect(await screen.findByText("It will carry on by itself.")).toBeInTheDocument();
    expect(store.retireReplacedClip).not.toHaveBeenCalled();
  });
});

describe("reading the thread clears that clip from the Coach Feedback dot (F15)", () => {
  it("marks this clip read up to the coach's newest comment, not the athlete's own", async () => {
    data.comments = [
      comment("c1", { createdAt: "2026-10-06T20:00:00.000Z" }),
      comment("c2", { createdAt: "2026-10-07T08:00:00.000Z", parentId: "c1" }),
      // The athlete's reply is never new to them and does not move the mark.
      comment("r1", { authorId: "joey", createdAt: "2026-10-08T08:00:00.000Z", parentId: "c1" }),
    ];
    await open();
    await waitFor(() => expect(badge.markSetSeen).toHaveBeenCalledWith("st-1", "2026-10-07T08:00:00.000Z"));
  });

  it("marks nothing when the coach has said nothing on this clip", async () => {
    data.comments = [comment("r1", { authorId: "joey" })];
    await open();
    await screen.findByText("Hips shot up on rep two.");
    expect(badge.markSetSeen).not.toHaveBeenCalled();
  });
});
