import { commentPermissions, reactionPermissions } from "./policy";
import { isReactionEmoji, REACTION_EMOJIS, REACTION_NAMES } from "./reaction";
import type { RowWriter } from "./row-writer";
import { changeReaction, OWN_MESSAGE, reactToComment, removeReaction, type WriteDeps } from "./write";

/**
 * The write boundary for reactions (F25): Zod refuses anything outside Joey's
 * six before a request is made, the helper refuses a reaction on your own
 * message, and every write is stamped by the policy.
 */

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const NOW = new Date("2026-11-02T19:30:00.000Z");

function harness() {
  const calls: { op: string; tableId: string; rowId: string; data?: Record<string, unknown>; permissions?: string[] }[] = [];
  const writer: RowWriter = {
    async createRow({ tableId, rowId, data, permissions }) {
      calls.push({ op: "create", tableId, rowId, data, permissions });
      return { $id: rowId, ...data };
    },
    async updateRow({ tableId, rowId, data, permissions }) {
      calls.push({ op: "update", tableId, rowId, data, permissions });
      return { $id: rowId };
    },
    async deleteRow({ tableId, rowId }) {
      calls.push({ op: "delete", tableId, rowId });
      return {};
    },
  };
  const deps: WriteDeps = { writer, databaseId: "db", newId: () => "unused", now: () => NOW };
  return { calls, deps };
}

const onCoachComment = {
  commentId: "comment_1",
  commentAuthorId: COACH,
  setId: "set_1",
  athleteId: ATHLETE,
  emoji: "👍" as const,
  clientReactionId: "reaction_1",
};

describe("the six", () => {
  it("are Joey's, in his order", () => {
    expect(REACTION_EMOJIS).toEqual(["👍", "💪", "🔥", "❤️", "😂", "❓"]);
    expect(Object.keys(REACTION_NAMES)).toEqual([...REACTION_EMOJIS]);
  });

  it("match exactly, so a bare heart without its variation selector is a different string", () => {
    expect(isReactionEmoji("❤️")).toBe(true);
    expect(isReactionEmoji("❤")).toBe(false);
    expect(isReactionEmoji(" 👍")).toBe(false);
    expect(isReactionEmoji(undefined)).toBe(false);
  });
});

describe("reactToComment", () => {
  it("writes the reaction at its client id, denormalised and stamped like a comment by the reactor", async () => {
    const { calls, deps } = harness();
    await reactToComment(deps, { userId: ATHLETE }, onCoachComment);
    expect(calls).toEqual([
      {
        op: "create",
        tableId: "comment_reactions",
        rowId: "reaction_1",
        data: {
          comment_id: "comment_1",
          set_id: "set_1",
          athlete_id: ATHLETE,
          author_id: ATHLETE,
          emoji: "👍",
          created_at: NOW.toISOString(),
          client_reaction_id: "reaction_1",
        },
        permissions: commentPermissions({ athleteId: ATHLETE, authorId: ATHLETE }),
      },
    ]);
  });

  it("stamps the coach's reaction for the athlete's circle, by the coach", async () => {
    const { calls, deps } = harness();
    await reactToComment(deps, { userId: COACH }, { ...onCoachComment, commentAuthorId: ATHLETE });
    expect(calls[0].data).toMatchObject({ author_id: COACH, athlete_id: ATHLETE });
    expect(calls[0].permissions).toEqual(reactionPermissions({ athleteId: ATHLETE, authorId: COACH }));
  });

  it("refuses a reaction on your own message without writing anything", async () => {
    const { calls, deps } = harness();
    await expect(reactToComment(deps, { userId: COACH }, onCoachComment)).rejects.toThrow(OWN_MESSAGE);
    expect(calls).toEqual([]);
  });

  it.each(["🍆", "❤", "", "👍👍", "thumbs up"])("refuses %j at the boundary, before any request", async (emoji) => {
    const { calls, deps } = harness();
    await expect(reactToComment(deps, { userId: ATHLETE }, { ...onCoachComment, emoji } as never)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("refuses an id Appwrite would not accept, with a message rather than a 400", async () => {
    const { calls, deps } = harness();
    await expect(
      reactToComment(deps, { userId: ATHLETE }, { ...onCoachComment, clientReactionId: "x".repeat(37) }),
    ).rejects.toThrow();
    await expect(reactToComment(deps, { userId: ATHLETE }, { ...onCoachComment, commentId: "" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("changeReaction", () => {
  it("moves only the emoji, re-stamped, on the same row", async () => {
    const { calls, deps } = harness();
    await changeReaction(deps, { userId: ATHLETE }, { rowId: "reaction_1", athleteId: ATHLETE, emoji: "🔥" });
    expect(calls).toEqual([
      {
        op: "update",
        tableId: "comment_reactions",
        rowId: "reaction_1",
        data: { emoji: "🔥" },
        permissions: reactionPermissions({ athleteId: ATHLETE, authorId: ATHLETE }),
      },
    ]);
  });

  it("refuses an emoji outside the six", async () => {
    const { calls, deps } = harness();
    await expect(
      changeReaction(deps, { userId: ATHLETE }, { rowId: "reaction_1", athleteId: ATHLETE, emoji: "🍆" } as never),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("removeReaction", () => {
  it("deletes the row; Appwrite refuses anyone but its author", async () => {
    const { calls, deps } = harness();
    await removeReaction(deps, { userId: ATHLETE }, "reaction_1");
    expect(calls).toEqual([{ op: "delete", tableId: "comment_reactions", rowId: "reaction_1" }]);
  });
});
