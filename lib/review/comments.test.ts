import {
  authorLabel,
  checkComment,
  countBySet,
  MAX_COMMENT_LENGTH,
  rejectionMessage,
  threadComments,
  type Comment,
} from "./comments";

const comment = (over: Partial<Comment> & Pick<Comment, "id">): Comment => ({
  setId: "set1",
  athleteId: "joey",
  authorId: "ruairi",
  body: "Hips shot up on the second rep.",
  parentId: null,
  createdAt: "2026-09-11T10:00:00.000Z",
  ...over,
});

describe("checkComment", () => {
  it("accepts an ordinary correction", () => {
    expect(checkComment("Keep 170 next week.")).toEqual({ ok: true, body: "Keep 170 next week." });
  });

  it("trims, so a trailing newline is not a longer comment", () => {
    expect(checkComment("  Good depth.\n\n  ")).toEqual({ ok: true, body: "Good depth." });
  });

  it("refuses an empty box, and whitespace is empty", () => {
    expect(checkComment("")).toEqual({ ok: false, reason: "empty" });
    expect(checkComment("   \n\t ")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a comment exactly at the limit", () => {
    // The boundary is inclusive. Refusing the last allowed character is the
    // classic off-by-one, and here it costs a coach their paragraph.
    expect(checkComment("x".repeat(MAX_COMMENT_LENGTH)).ok).toBe(true);
  });

  it("refuses one character past it, and says how far over", () => {
    const result = checkComment("x".repeat(MAX_COMMENT_LENGTH + 7));
    expect(result).toEqual({ ok: false, reason: "too-long", over: 7 });
  });

  it("measures the trimmed length, not the raw one", () => {
    const padded = `  ${"x".repeat(MAX_COMMENT_LENGTH)}  `;
    expect(checkComment(padded).ok).toBe(true);
  });
});

describe("rejectionMessage", () => {
  it("says what is wrong without blaming the coach", () => {
    expect(rejectionMessage({ ok: false, reason: "empty" })).toBe("Nothing to post yet.");
    expect(rejectionMessage({ ok: false, reason: "too-long", over: 12 })).toContain("12 characters too long");
  });
});

describe("threadComments", () => {
  it("puts replies under the comment they answer", () => {
    const threads = threadComments([
      comment({ id: "reply", parentId: "root", authorId: "joey", createdAt: "2026-09-11T11:00:00.000Z" }),
      comment({ id: "root" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comment.id).toBe("root");
    expect(threads[0].replies.map((r) => r.id)).toEqual(["reply"]);
  });

  it("orders threads and replies oldest first", () => {
    const threads = threadComments([
      comment({ id: "b", createdAt: "2026-09-12T10:00:00.000Z" }),
      comment({ id: "a", createdAt: "2026-09-11T10:00:00.000Z" }),
      comment({ id: "a2", parentId: "a", createdAt: "2026-09-11T12:00:00.000Z" }),
      comment({ id: "a1", parentId: "a", createdAt: "2026-09-11T11:00:00.000Z" }),
    ]);
    expect(threads.map((t) => t.comment.id)).toEqual(["a", "b"]);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("flattens a reply to a reply onto its thread rather than nesting again", () => {
    // The blueprint is explicit that this is not a chat product. Indenting
    // further invites the conversation the screen is trying not to host.
    const threads = threadComments([
      comment({ id: "root" }),
      comment({ id: "one", parentId: "root", createdAt: "2026-09-11T11:00:00.000Z" }),
      comment({ id: "two", parentId: "one", createdAt: "2026-09-11T12:00:00.000Z" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["one", "two"]);
  });

  it("promotes an orphaned reply instead of losing it", () => {
    // The parent was deleted by its author. Losing the athlete's answer because
    // the question went away is worse than showing it on its own.
    const threads = threadComments([comment({ id: "orphan", parentId: "gone" })]);
    expect(threads.map((t) => t.comment.id)).toEqual(["orphan"]);
  });

  it("does not hang on a cycle", () => {
    // Only reachable from corrupt data, and a spin here freezes the screen.
    const threads = threadComments([
      comment({ id: "a", parentId: "b" }),
      comment({ id: "b", parentId: "a" }),
    ]);
    expect(threads.length).toBeGreaterThanOrEqual(0);
  });

  it("sorts an unreadable date last rather than dropping the thread", () => {
    const threads = threadComments([
      comment({ id: "bad", createdAt: "not a date" }),
      comment({ id: "good" }),
    ]);
    expect(threads.map((t) => t.comment.id)).toEqual(["good", "bad"]);
  });

  it("is empty for no comments", () => {
    expect(threadComments([])).toEqual([]);
  });
});

describe("authorLabel", () => {
  const names = new Map([["joey", "Joey P"]]);

  it("calls the viewer You", () => {
    expect(authorLabel(comment({ id: "a", authorId: "ruairi" }), names, "ruairi", "Your athlete")).toBe("You");
  });

  it("names the other party when it can", () => {
    expect(authorLabel(comment({ id: "a", authorId: "joey" }), names, "ruairi", "Your athlete")).toBe("Joey P");
  });

  it("falls back to the caller's word, never to a raw id", () => {
    // The fallback differs by side: the coach reads an athlete, the athlete
    // reads their coach. A raw user id on either would be worse than both.
    const unknown = comment({ id: "a", authorId: "nobody" });
    expect(authorLabel(unknown, names, "ruairi", "Your athlete")).toBe("Your athlete");
    expect(authorLabel(unknown, names, "joey", "Your coach")).toBe("Your coach");
  });
});

describe("countBySet", () => {
  it("counts replies as well as opening comments", () => {
    const counts = countBySet([
      comment({ id: "a", setId: "s1" }),
      comment({ id: "b", setId: "s1", parentId: "a" }),
      comment({ id: "c", setId: "s2" }),
    ]);
    expect(counts.get("s1")).toBe(2);
    expect(counts.get("s2")).toBe(1);
    expect(counts.has("s3")).toBe(false);
  });
});
