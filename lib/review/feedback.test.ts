import type { Comment } from "./comments";
import {
  buildFeedback,
  countUnread,
  isUnread,
  nextSeenAt,
  replyParentId,
  setIdsToFetch,
  unreadLabel,
  type FeedbackSet,
} from "./feedback";

const ATHLETE = "athlete";
const COACH = "coach";

const comment = (overrides: Partial<Comment> & Pick<Comment, "id">): Comment => ({
  setId: "set-1",
  athleteId: ATHLETE,
  authorId: COACH,
  body: "Hips shot up.",
  parentId: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  ...overrides,
});

const set = (id: string, overrides: Partial<FeedbackSet> = {}): FeedbackSet => ({
  id,
  sessionId: "session-1",
  exerciseId: "squat",
  setIndex: 2,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  isWarmup: false,
  loggedAt: "2026-09-19T18:00:00.000Z",
  videoFileId: "clip-1",
  notes: null,
  ...overrides,
});

describe("isUnread", () => {
  it("never counts the athlete's own reply as new to them", () => {
    expect(isUnread(comment({ id: "r", authorId: ATHLETE }), ATHLETE, null)).toBe(false);
  });

  it("counts everything the coach said when there is no watermark yet", () => {
    // A new device. Old feedback shown as new costs a tap; the reverse costs
    // a correction nobody read.
    expect(isUnread(comment({ id: "c" }), ATHLETE, null)).toBe(true);
  });

  it("is strictly after the watermark, so the comment that set it is not new", () => {
    const c = comment({ id: "c", createdAt: "2026-09-20T10:00:00.000Z" });
    expect(isUnread(c, ATHLETE, "2026-09-20T10:00:00.000Z")).toBe(false);
    expect(isUnread(c, ATHLETE, "2026-09-20T09:59:59.999Z")).toBe(true);
  });
});

describe("countUnread", () => {
  it("counts only the coach's comments past the watermark", () => {
    const comments = [
      comment({ id: "old", createdAt: "2026-09-18T10:00:00.000Z" }),
      comment({ id: "new", createdAt: "2026-09-21T10:00:00.000Z" }),
      comment({ id: "mine", authorId: ATHLETE, createdAt: "2026-09-22T10:00:00.000Z" }),
    ];
    expect(countUnread(comments, ATHLETE, "2026-09-20T00:00:00.000Z")).toBe(1);
  });
});

describe("buildFeedback", () => {
  it("puts every comment on a set onto one card, threaded", () => {
    const cards = buildFeedback(
      [
        comment({ id: "c1" }),
        comment({ id: "r1", authorId: ATHLETE, parentId: "c1", createdAt: "2026-09-20T11:00:00.000Z" }),
      ],
      new Map([["set-1", set("set-1")]]),
      ATHLETE,
      null,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].threads).toHaveLength(1);
    expect(cards[0].threads[0].replies.map((r) => r.id)).toEqual(["r1"]);
    expect(cards[0].set?.loadKg).toBe(180);
  });

  it("orders cards by the newest thing said on them, not by when the set was lifted", () => {
    const cards = buildFeedback(
      [
        comment({ id: "a", setId: "tuesday", createdAt: "2026-09-21T10:00:00.000Z" }),
        comment({ id: "b", setId: "monday", createdAt: "2026-09-20T10:00:00.000Z" }),
        // A reply today brings Monday's set back to the top.
        comment({ id: "c", setId: "monday", authorId: ATHLETE, parentId: "b", createdAt: "2026-09-22T10:00:00.000Z" }),
      ],
      new Map(),
      ATHLETE,
      null,
    );
    expect(cards.map((c) => c.setId)).toEqual(["monday", "tuesday"]);
  });

  it("breaks ties on set id so the list holds still", () => {
    const at = "2026-09-21T10:00:00.000Z";
    const cards = buildFeedback(
      [comment({ id: "1", setId: "b", createdAt: at }), comment({ id: "2", setId: "a", createdAt: at })],
      new Map(),
      ATHLETE,
      null,
    );
    expect(cards.map((c) => c.setId)).toEqual(["a", "b"]);
  });

  it("keeps a card whose set has been deleted, with no numbers", () => {
    const cards = buildFeedback([comment({ id: "c", setId: "gone" })], new Map(), ATHLETE, null);
    expect(cards).toHaveLength(1);
    expect(cards[0].set).toBeNull();
  });

  it("counts unread per card", () => {
    const cards = buildFeedback(
      [
        comment({ id: "old", setId: "x", createdAt: "2026-09-18T10:00:00.000Z" }),
        comment({ id: "new", setId: "y", createdAt: "2026-09-21T10:00:00.000Z" }),
      ],
      new Map(),
      ATHLETE,
      "2026-09-20T00:00:00.000Z",
    );
    expect(Object.fromEntries(cards.map((c) => [c.setId, c.unread]))).toEqual({ x: 0, y: 1 });
  });

  it("returns nothing for an athlete nobody has spoken to", () => {
    expect(buildFeedback([], new Map(), ATHLETE, null)).toEqual([]);
  });
});

describe("nextSeenAt", () => {
  it("is the newest coach comment on screen, in the coach's clock", () => {
    const comments = [
      comment({ id: "a", createdAt: "2026-09-20T10:00:00.000Z" }),
      comment({ id: "b", createdAt: "2026-09-21T10:00:00.000Z" }),
    ];
    expect(nextSeenAt(comments, ATHLETE, null)).toBe("2026-09-21T10:00:00.000Z");
  });

  it("ignores the athlete's own replies, so replying does not hide what came after", () => {
    // The athlete's phone clock could be ahead of the coach's. If their own
    // reply moved the watermark, the coach's answer to it could land "before"
    // it and never show as new.
    const comments = [
      comment({ id: "a", createdAt: "2026-09-20T10:00:00.000Z" }),
      comment({ id: "mine", authorId: ATHLETE, createdAt: "2026-09-25T10:00:00.000Z" }),
    ];
    expect(nextSeenAt(comments, ATHLETE, null)).toBe("2026-09-20T10:00:00.000Z");
  });

  it("never moves backwards", () => {
    const comments = [comment({ id: "a", createdAt: "2026-09-20T10:00:00.000Z" })];
    expect(nextSeenAt(comments, ATHLETE, "2026-09-22T00:00:00.000Z")).toBe("2026-09-22T00:00:00.000Z");
  });

  it("skips an unreadable date rather than storing it", () => {
    expect(nextSeenAt([comment({ id: "a", createdAt: "not a date" })], ATHLETE, null)).toBeNull();
  });

  it("stays null with nothing from the coach", () => {
    expect(nextSeenAt([], ATHLETE, null)).toBeNull();
  });
});

describe("replyParentId", () => {
  it("answers the most recent thread's opening comment", () => {
    const [card] = buildFeedback(
      [
        comment({ id: "first", createdAt: "2026-09-18T10:00:00.000Z" }),
        comment({ id: "second", createdAt: "2026-09-20T10:00:00.000Z" }),
        comment({ id: "reply", authorId: ATHLETE, parentId: "second", createdAt: "2026-09-20T11:00:00.000Z" }),
      ],
      new Map(),
      ATHLETE,
      null,
    );
    expect(replyParentId(card)).toBe("second");
  });
});

describe("setIdsToFetch", () => {
  it("is one de-duplicated list, so the sets cost one query", () => {
    expect(
      setIdsToFetch([comment({ id: "a", setId: "s1" }), comment({ id: "b", setId: "s1" })], ["s2", "s1", ""]),
    ).toEqual(["s1", "s2"]);
  });
});

describe("unreadLabel", () => {
  it("says nothing at zero and stops counting past nine", () => {
    expect(unreadLabel(0)).toBe("");
    expect(unreadLabel(3)).toBe("3 new");
    expect(unreadLabel(10)).toBe("9+ new");
  });
});
