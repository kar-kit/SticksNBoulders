import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { CommentThread } from "./comment-thread";
import type { Comment } from "@/lib/review/comments";
import type { Reaction } from "@/lib/review/reactions";
import { useReactions } from "@/lib/review/use-reactions";

/**
 * Reactions as the coach meets them (F25): under `CommentThread`, which the
 * Review Queue's comment box, the Athlete View's clip dialog and the athlete's
 * clip page all draw. The Feedback screen's own tests cover the athlete side.
 */

const sendReaction = vi.hoisted(() => vi.fn());
let nextId = 0;
vi.mock("@/lib/review/reaction-store", () => ({ sendReaction, newReactionId: () => `new-${++nextId}` }));

const RUAIRI = "ruairi";
const JOEY = "joey";

const opener: Comment = {
  id: "c1",
  setId: "s1",
  athleteId: JOEY,
  authorId: RUAIRI,
  body: "Hips shot up.",
  parentId: null,
  createdAt: "2026-11-01T18:00:00.000Z",
};
const reply: Comment = { ...opener, id: "c2", authorId: JOEY, parentId: "c1", body: "Felt it.", createdAt: "2026-11-01T18:10:00.000Z" };

/** One list, not a fresh [] per render, or the load effect below would loop. */
const NONE: Reaction[] = [];

function Thread({ loaded = NONE, viewerId = RUAIRI }: { loaded?: Reaction[]; viewerId?: string }) {
  const comments = [opener, reply];
  const { controls, setLoaded } = useReactions({ comments, viewerId });
  useEffect(() => setLoaded(loaded), [loaded, setLoaded]);
  return (
    <CommentThread comments={comments} names={new Map([[JOEY, "Joey"]])} viewerId={viewerId} reactions={controls} />
  );
}

beforeEach(() => {
  nextId = 0;
  sendReaction.mockReset();
  sendReaction.mockImplementation(async ({ plan, comment, newId }: { plan: { kind: string; emoji?: string }; comment: Comment; newId: string }) => ({
    ok: true,
    reaction:
      plan.kind === "create"
        ? { id: newId, commentId: comment.id, setId: comment.setId, athleteId: comment.athleteId, authorId: RUAIRI, emoji: plan.emoji, createdAt: "2026-11-02T09:00:00.000Z" }
        : null,
  }));
});

describe("reactions in a thread, from the coach's side", () => {
  it("lets the coach react to the athlete's reply and not to his own message", () => {
    render(<Thread />);
    expect(screen.getAllByRole("button", { name: /^React to/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "React to Joey's message",
    ]);
  });

  it("toggles: one tap leaves it, the same tap takes it back", async () => {
    const user = userEvent.setup();
    render(<Thread />);
    await user.click(screen.getByRole("button", { name: "React to Joey's message" }));
    await user.click(screen.getByRole("button", { name: "React thumbs up" }));
    const chip = await screen.findByRole("button", { name: "thumbs up, yours" });
    await waitFor(() => expect(chip).toBeEnabled());

    await user.click(chip);
    await waitFor(() => expect(screen.queryByRole("button", { name: /thumbs up/ })).not.toBeInTheDocument());
    expect(sendReaction.mock.calls.map(([request]) => request.plan)).toEqual([
      { kind: "create", emoji: "👍" },
      // The create's own id: the row on screen is the row on the instance.
      { kind: "remove", rowId: "new-1" },
    ]);
  });

  it("replaces rather than stacks: one person, one reaction per message", async () => {
    const user = userEvent.setup();
    render(<Thread loaded={[{ id: "r1", commentId: "c2", setId: "s1", athleteId: JOEY, authorId: RUAIRI, emoji: "👍", createdAt: "x" }]} />);
    await user.click(await screen.findByRole("button", { name: "Change your reaction to Joey's message" }));
    const picker = screen.getByRole("group", { name: "Reactions" });
    // The current one says what tapping it does.
    expect(within(picker).getByRole("button", { name: "Remove thumbs up" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(picker).getByRole("button", { name: "React question" }));

    expect(await screen.findByRole("button", { name: "question, yours" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /thumbs up/ })).not.toBeInTheDocument();
    expect(sendReaction).toHaveBeenCalledWith(expect.objectContaining({ plan: { kind: "change", rowId: "r1", emoji: "❓" } }));
  });

  it("shows the athlete's reaction on the coach's own message without letting him touch it", async () => {
    render(<Thread loaded={[{ id: "r9", commentId: "c1", setId: "s1", athleteId: JOEY, authorId: JOEY, emoji: "❓", createdAt: "x" }]} />);
    expect(await screen.findByRole("img", { name: "question, 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^question/ })).not.toBeInTheDocument();
  });

  it("reverts quietly and says so in a small line when the write fails", async () => {
    sendReaction.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    render(<Thread />);
    await user.click(screen.getByRole("button", { name: "React to Joey's message" }));
    await user.click(screen.getByRole("button", { name: "React fire" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/didn't save/);
    expect(screen.queryByRole("button", { name: /fire/ })).not.toBeInTheDocument();
  });

  it("closes the picker on Escape and hands focus back to the button that opened it", async () => {
    const user = userEvent.setup();
    render(<Thread />);
    const trigger = screen.getByRole("button", { name: "React to Joey's message" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "React thumbs up" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "React strong" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Reactions" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps Enter and Space from the window, so choosing 👍 never also clears the clip or plays it", async () => {
    // The Review Queue clears on a bare Enter, the player plays on Space, both on the window.
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      const user = userEvent.setup();
      render(<Thread />);
      screen.getByRole("button", { name: "React to Joey's message" }).focus();
      await user.keyboard("{Enter}");
      await user.keyboard(" ");
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("drops a reaction on a message that is no longer in the thread", async () => {
    render(<Thread loaded={[{ id: "orphan", commentId: "withdrawn", setId: "s1", athleteId: JOEY, authorId: JOEY, emoji: "🔥", createdAt: "x" }]} />);
    await screen.findByText("Felt it.");
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();
  });
});
