import { reactionPermissions } from "@/appwrite/documents/policy";
import { isAuthentic, verdictFor } from "@/appwrite/documents/provenance";
import type { Comment } from "./comments";
import { buildFeedback, countUnread, nextSeenAt, type FeedbackSet } from "./feedback";
import {
  canReactTo,
  chipLabel,
  myReaction,
  planReaction,
  reactionAfter,
  reactionChips,
  reactionsByComment,
  replaceMine,
  toReaction,
  trustedReactions,
  type Reaction,
} from "./reactions";

/**
 * The rules a tap and a read pass through (F25). The UI tests drive the same
 * rules through the screens; these pin each edge on its own.
 */

const JOEY = "joey";
const RUAIRI = "ruairi";
const LOUIS = "louis";

const comment = (over: Partial<Comment> & Pick<Comment, "id">): Comment => ({
  setId: "s1",
  athleteId: JOEY,
  authorId: RUAIRI,
  body: "Brace harder.",
  parentId: null,
  createdAt: "2026-11-01T18:00:00.000Z",
  ...over,
});

const reaction = (over: Partial<Reaction> & Pick<Reaction, "id">): Reaction => ({
  commentId: "c1",
  setId: "s1",
  athleteId: JOEY,
  authorId: JOEY,
  emoji: "👍",
  createdAt: "2026-11-01T18:05:00.000Z",
  ...over,
});

const opener = comment({ id: "c1" });
const reply = comment({ id: "c2", authorId: JOEY, parentId: "c1", body: "Felt it.", createdAt: "2026-11-01T18:10:00.000Z" });

describe("toReaction", () => {
  const row = { $id: "r1", comment_id: "c1", set_id: "s1", athlete_id: JOEY, author_id: JOEY, emoji: "🔥", created_at: "x" };

  it("reads a stored row", () => {
    expect(toReaction(row)).toEqual({ id: "r1", commentId: "c1", setId: "s1", athleteId: JOEY, authorId: JOEY, emoji: "🔥", createdAt: "x" });
  });

  it("drops an emoji outside the six, so a reader never draws one the validator has not reached yet", () => {
    expect(toReaction({ ...row, emoji: "🍆" })).toBeNull();
    expect(toReaction({ ...row, emoji: "❤" })).toBeNull();
  });

  it("drops a row that says nothing about what it is on, or who left it", () => {
    expect(toReaction({ ...row, comment_id: "" })).toBeNull();
    expect(toReaction({ ...row, author_id: undefined })).toBeNull();
  });

  it("agrees with validate-row: what the Function would keep is exactly what a reader draws", () => {
    const stamped = (over: Record<string, unknown>) => ({
      ...row,
      ...over,
      $permissions: reactionPermissions({ athleteId: JOEY, authorId: String(over.author_id ?? JOEY) }),
    });
    const rows = [
      stamped({}),
      stamped({ emoji: "🍆" }),
      stamped({ emoji: "❤️" }),
      { ...row, $permissions: ['read("users")'] },
      stamped({ author_id: RUAIRI }),
    ];
    for (const r of rows) {
      const drawn = isAuthentic("comment_reactions", r) && toReaction(r) !== null;
      expect(verdictFor("comment_reactions", r).action === "keep", JSON.stringify(r.emoji)).toBe(drawn);
    }
  });
});

describe("trustedReactions", () => {
  it("keeps a reaction on a comment on screen, by somebody other than its author", () => {
    const r = reaction({ id: "r1" });
    expect(trustedReactions([r], [opener])).toEqual([r]);
  });

  it("drops a reaction whose comment is gone: withdrawn, or not in the page read", () => {
    expect(trustedReactions([reaction({ id: "r1", commentId: "withdrawn" })], [opener])).toEqual([]);
  });

  it("drops a reaction on your own message, which the helper refuses but the row cannot", () => {
    expect(trustedReactions([reaction({ id: "r1", commentId: "c2", authorId: JOEY })], [opener, reply])).toEqual([]);
  });

  it("drops a reaction that claims another set or athlete than its comment", () => {
    expect(trustedReactions([reaction({ id: "r1", setId: "s9" })], [opener])).toEqual([]);
    expect(trustedReactions([reaction({ id: "r1", athleteId: "sam" })], [opener])).toEqual([]);
  });

  it("never shows one person twice on one message: the newer wins", () => {
    const older = reaction({ id: "r1", emoji: "👍", createdAt: "2026-11-01T18:05:00.000Z" });
    const newer = reaction({ id: "r2", emoji: "🔥", createdAt: "2026-11-01T18:06:00.000Z" });
    expect(trustedReactions([newer, older], [opener])).toEqual([newer]);
  });

  it("keeps two coaches' reactions on one reply apart", () => {
    const both = [
      reaction({ id: "r1", commentId: "c2", authorId: RUAIRI }),
      reaction({ id: "r2", commentId: "c2", authorId: LOUIS }),
    ];
    expect(trustedReactions(both, [opener, reply])).toHaveLength(2);
  });
});

describe("reactionChips", () => {
  it("draws one chip per emoji used, in Joey's order rather than by count, the viewer's own marked", () => {
    const onReply = [
      reaction({ id: "a", commentId: "c2", authorId: RUAIRI, emoji: "❓" }),
      reaction({ id: "b", commentId: "c2", authorId: LOUIS, emoji: "👍" }),
      reaction({ id: "c", commentId: "c2", authorId: "third", emoji: "❓" }),
    ];
    expect(reactionChips(onReply, RUAIRI)).toEqual([
      { emoji: "👍", count: 1, mine: false },
      { emoji: "❓", count: 2, mine: true },
    ]);
  });

  it("says who it is for a screen reader without a raw count of one being the whole story", () => {
    expect(chipLabel({ emoji: "🔥", count: 1, mine: false }, "fire")).toBe("fire, 1");
    expect(chipLabel({ emoji: "🔥", count: 1, mine: true }, "fire")).toBe("fire, yours");
    expect(chipLabel({ emoji: "🔥", count: 2, mine: true }, "fire")).toBe("fire, 2 including yours");
  });
});

describe("what a tap means", () => {
  it("creates when there is nothing yet", () => {
    expect(planReaction(null, "👍")).toEqual({ kind: "create", emoji: "👍" });
  });

  it("takes it back when the same emoji is tapped again", () => {
    expect(planReaction(reaction({ id: "r1", emoji: "👍" }), "👍")).toEqual({ kind: "remove", rowId: "r1" });
  });

  it("replaces it, as a change of the same row, when another emoji is tapped", () => {
    expect(planReaction(reaction({ id: "r1", emoji: "👍" }), "🔥")).toEqual({ kind: "change", rowId: "r1", emoji: "🔥" });
  });

  it("is never available on your own message", () => {
    expect(canReactTo(opener, RUAIRI)).toBe(false);
    expect(canReactTo(opener, JOEY)).toBe(true);
    expect(canReactTo(opener, "")).toBe(false);
  });
});

describe("the optimistic step and its undo", () => {
  const now = new Date("2026-11-02T08:00:00.000Z");

  it("draws a create at the id it will be written at", () => {
    const after = reactionAfter({ kind: "create", emoji: "💪" }, null, opener, JOEY, "new-id", now);
    expect(after).toEqual({ id: "new-id", commentId: "c1", setId: "s1", athleteId: JOEY, authorId: JOEY, emoji: "💪", createdAt: now.toISOString() });
  });

  it("keeps the row's id and age on a change, and removes it on a remove", () => {
    const current = reaction({ id: "r1", emoji: "👍" });
    expect(reactionAfter({ kind: "change", rowId: "r1", emoji: "😂" }, current, opener, JOEY, "unused", now)).toEqual({ ...current, emoji: "😂" });
    expect(reactionAfter({ kind: "remove", rowId: "r1" }, current, opener, JOEY, "unused", now)).toBeNull();
  });

  it("replaces only the viewer's reaction on that one message, and puts it back exactly", () => {
    const mine = reaction({ id: "r1" });
    const coachOnReply = reaction({ id: "r2", commentId: "c2", authorId: RUAIRI });
    const mineElsewhere = reaction({ id: "r3", commentId: "c9" });
    const before = [mine, coachOnReply, mineElsewhere];

    const optimistic = replaceMine(before, "c1", JOEY, { ...mine, emoji: "🔥" });
    expect(myReaction(optimistic, "c1", JOEY)?.emoji).toBe("🔥");
    expect(optimistic).toContain(coachOnReply);
    expect(optimistic).toContain(mineElsewhere);

    const reverted = replaceMine(optimistic, "c1", JOEY, mine);
    expect(reactionsByComment(reverted).get("c1")).toEqual([mine]);
    expect(replaceMine(before, "c1", JOEY, null).map((r) => r.id)).toEqual(["r2", "r3"]);
  });
});

/**
 * Joey, 2 Nov 2026: reactions never count toward unread badges, the "new"
 * markers or any notification, and never move a watermark. Those are all
 * computed from comments; this pins that a thread full of fresh reactions
 * computes them exactly as the bare thread does.
 */
describe("reactions are quiet", () => {
  const set: FeedbackSet = {
    id: "s1",
    sessionId: "x",
    exerciseId: "squat",
    setIndex: 1,
    loadKg: 180,
    reps: 3,
    rpe: 8,
    isWarmup: false,
    loggedAt: "2026-11-01T17:00:00.000Z",
    videoFileId: null,
    notes: null,
  };
  const comments = [opener, reply];
  // The coach reacted to Joey's reply AFTER Joey last looked, and after every comment.
  const coachReaction = reaction({ id: "late", commentId: "c2", authorId: RUAIRI, emoji: "🔥", createdAt: "2026-11-02T07:00:00.000Z" });
  const seenAt = "2026-11-01T18:30:00.000Z";

  it("adds nothing to the unread count or the New mark", () => {
    const withReactions = trustedReactions([coachReaction], comments);
    expect(withReactions).toHaveLength(1);
    expect(countUnread(comments, JOEY, seenAt)).toBe(0);
    const [card] = buildFeedback(comments, new Map([["s1", set]]), JOEY, seenAt);
    expect(card.unread).toBe(0);
  });

  it("does not move the conversation up the list or the watermark forward", () => {
    const [card] = buildFeedback(comments, new Map([["s1", set]]), JOEY, seenAt);
    expect(card.lastActivityAt).toBe(reply.createdAt);
    expect(nextSeenAt(comments, JOEY, seenAt)).toBe(seenAt);
  });

  it("is not a comment by type, so nothing that counts comments can be handed one", () => {
    // A Reaction carries no body and no parentId; feedback.ts never imports
    // this module. Pinned so a later "unify the two" refactor has to say so.
    expect(Object.keys(coachReaction)).not.toContain("body");
  });
});
