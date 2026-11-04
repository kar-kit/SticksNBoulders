import type { Comment } from "./comments";
import {
  isAthleteReply,
  markFor,
  newestPosted,
  replyThreads,
  snippet,
  threadHref,
  threadViewHref,
  unreadThreadCount,
  watermark,
} from "./replies";

/**
 * The coach's unread arithmetic (F26). Each case is a way the badge could lie:
 * counting the coach's own words, a colleague's, an unlinked athlete's, or
 * trusting a phone's clock over the server's.
 */

const COACH = "ruairi";
const LOUIS = "louis";
const JOEY = "joey";
const SAM = "sam";
const scope = { coachId: COACH, athleteIds: [JOEY, SAM] };

let n = 0;
const said = (
  setId: string,
  authorId: string,
  postedAt: string,
  over: Partial<Comment> = {},
): Comment => ({
  id: `c${++n}`,
  setId,
  athleteId: JOEY,
  authorId,
  body: `${authorId} on ${setId}`,
  parentId: null,
  createdAt: postedAt,
  postedAt,
  ...over,
});

const t = (h: number) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();

describe("whose words count", () => {
  it("counts the athlete talking in their own set's thread", () => {
    const thread = replyThreads([said("s1", COACH, t(9)), said("s1", JOEY, t(10))], new Map(), scope);
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ setId: "s1", athleteId: JOEY, unread: 1, replies: 1 });
  });

  it("never counts the coach's own comments, so a thread he alone spoke in is not in the list", () => {
    expect(replyThreads([said("s1", COACH, t(9)), said("s1", COACH, t(10))], new Map(), scope)).toEqual([]);
  });

  it("never counts a second coach on the same athlete -- Louis talking is not Joey answering", () => {
    expect(replyThreads([said("s1", LOUIS, t(10))], new Map(), scope)).toEqual([]);
    expect(isAthleteReply(said("s1", LOUIS, t(10)), scope)).toBe(false);
  });

  it("does not count a self-coached athlete talking to himself", () => {
    const self = { coachId: JOEY, athleteIds: [JOEY] };
    expect(replyThreads([said("s1", JOEY, t(10))], new Map(), self)).toEqual([]);
  });

  it("drops an athlete who is no longer linked, rather than lighting a badge for a thread he cannot open", () => {
    const gone = said("s9", "ex", t(10), { athleteId: "ex" });
    expect(replyThreads([gone], new Map(), scope)).toEqual([]);
  });

  it("does not count an athlete writing on somebody else's set", () => {
    expect(isAthleteReply(said("s1", SAM, t(10)), scope)).toBe(false);
  });
});

describe("what has been read", () => {
  it("reads a reply at or before the mark, and not one after it", () => {
    const comments = [said("s1", JOEY, t(10)), said("s1", JOEY, t(12))];
    const [thread] = replyThreads(comments, new Map([["s1", t(10)]]), scope);
    expect(thread.unread).toBe(1);
    expect(thread.replies).toBe(2);
  });

  it("treats answering as reading: the coach's own later comment clears what came before it", () => {
    const comments = [said("s1", JOEY, t(10)), said("s1", COACH, t(11))];
    expect(replyThreads(comments, new Map(), scope)[0].unread).toBe(0);
  });

  it("takes the later of the mark and his own last word", () => {
    const comments = [said("s1", JOEY, t(10)), said("s1", COACH, t(11)), said("s1", JOEY, t(12))];
    expect(watermark(comments, t(9), COACH)).toBe(new Date(t(11)).getTime());
    expect(replyThreads(comments, new Map([["s1", t(9)]]), scope)[0].unread).toBe(1);
  });

  it("compares on the server's clock, so a phone running slow cannot hide a reply", () => {
    // Joey's phone stamps created_at an hour behind; Appwrite says when it landed.
    const reply = said("s1", JOEY, t(12), { createdAt: t(8) });
    expect(replyThreads([reply], new Map([["s1", t(10)]]), scope)[0].unread).toBe(1);
  });

  it("falls back to created_at for a comment with no server time", () => {
    const local = said("s1", JOEY, t(12), { postedAt: undefined });
    expect(replyThreads([local], new Map([["s1", t(10)]]), scope)[0].unread).toBe(1);
  });

  it("counts an unreadable time as unread only until the thread is first read", () => {
    const broken = said("s1", JOEY, "not a date", { createdAt: "not a date" });
    expect(replyThreads([broken], new Map(), scope)[0].unread).toBe(1);
    expect(replyThreads([broken], new Map([["s1", t(1)]]), scope)[0].unread).toBe(0);
  });

  it("ignores a mark that is not a date, rather than reading the whole thread", () => {
    expect(replyThreads([said("s1", JOEY, t(10))], new Map([["s1", "garbage"]]), scope)[0].unread).toBe(1);
  });
});

describe("the list and the badge", () => {
  it("is newest reply first, one row per thread, read threads kept", () => {
    const comments = [
      said("old", JOEY, t(8)),
      said("new", SAM, t(14), { athleteId: SAM }),
      said("mid", JOEY, t(11)),
      said("mid", JOEY, t(9)),
    ];
    const threads = replyThreads(comments, new Map([["old", t(23)]]), scope);
    expect(threads.map((x) => x.setId)).toEqual(["new", "mid", "old"]);
    expect(threads[1].latest.postedAt).toBe(t(11));
    expect(threads[2].unread).toBe(0);
  });

  it("counts threads with anything unread, not messages, so the badge matches the bold rows", () => {
    const comments = [said("s1", JOEY, t(10)), said("s1", JOEY, t(11)), said("s2", JOEY, t(12)), said("s3", JOEY, t(1))];
    const threads = replyThreads(comments, new Map([["s3", t(2)]]), scope);
    expect(unreadThreadCount(threads)).toBe(2);
  });

  it("reads each thread through its newest comment by anyone", () => {
    const comments = [said("s1", JOEY, t(10)), said("s1", LOUIS, t(13))];
    expect(replyThreads(comments, new Map(), scope)[0].readThrough).toBe(t(13));
    expect(newestPosted([])).toBeNull();
  });
});

describe("the mark to write", () => {
  const comments = [said("s1", COACH, t(9)), said("s1", JOEY, t(10)), said("s1", JOEY, t(12))];
  const [thread] = replyThreads(comments, new Map(), scope);

  it("goes through the whole thread when the coach tapped its row", () => {
    expect(markFor(thread, undefined, COACH, comments)).toBe(t(12));
  });

  it("goes only as far as the screen shows, so a reply that arrived live stays unread", () => {
    const shown = comments.slice(0, 2);
    expect(markFor(thread, undefined, COACH, comments, shown)).toBe(t(10));
  });

  it("writes nothing when the screen shows nothing past the watermark", () => {
    const shown = [comments[0]];
    expect(markFor(thread, undefined, COACH, comments, shown)).toBeNull();
    expect(markFor(thread, t(10), COACH, comments, comments.slice(0, 2))).toBeNull();
  });

  it("writes nothing for a read thread or one not in the inbox", () => {
    const [read] = replyThreads(comments, new Map([["s1", t(12)]]), scope);
    expect(markFor(read, t(12), COACH, comments)).toBeNull();
    expect(markFor(undefined, undefined, COACH, comments)).toBeNull();
  });

  it("ignores comments from another set in what was shown", () => {
    const elsewhere = said("s2", JOEY, t(20));
    expect(markFor(thread, undefined, COACH, comments, [comments[1], elsewhere])).toBe(t(10));
  });
});

describe("links", () => {
  it("has a stable deep link that names only the set, for push (F27)", () => {
    expect(threadHref("set_123")).toBe("/coach/replies/set_123");
    expect(threadHref("a/b")).toBe("/coach/replies/a%2Fb");
  });

  it("opens the thread in the clip dialog over Athlete View", () => {
    expect(threadViewHref("joey", "set_123")).toBe("/coach/athletes/joey?clip=set_123");
  });
});

describe("snippet", () => {
  it("folds whitespace and keeps a short reply whole", () => {
    expect(snippet("Felt it.\n\nDropping  to 170.")).toBe("Felt it. Dropping to 170.");
  });

  it("cuts a long reply on a word", () => {
    const cut = snippet("word ".repeat(60), 30);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(31);
    expect(cut).not.toMatch(/wor…$/);
  });
});
