import { POLICIES } from "@/appwrite/documents/policy";
import { CLIP_FRESH_MS, classifyEvent, eventOp, isFreshClip, recipientsFor } from "./notify-event";

const A = "athlete_a";
const C = "coach_c";
const STRANGER = "user_x";
const DOCS = (table: string, op: string) => `databases.sticksnboulders.collections.${table}.documents.row1.${op}`;
const ROWS = (table: string, op: string) => `databases.sticksnboulders.tables.${table}.rows.row1.${op}`;

const set = (over: Record<string, unknown> = {}) => ({
  $id: "set1",
  $tableId: "sets",
  athlete_id: A,
  exercise_id: "ex_squat",
  video_file_id: "file1",
  $permissions: POLICIES.sets({ athleteId: A }),
  ...over,
});

const comment = (over: Record<string, unknown> = {}) => ({
  $id: "c1",
  $tableId: "set_comments",
  set_id: "set1",
  athlete_id: A,
  author_id: A,
  parent_id: "c0",
  body: "Felt the hips shoot up",
  $permissions: POLICIES.set_comments({ athleteId: A, authorId: A }),
  ...over,
});

describe("eventOp", () => {
  it("reads the operation off either spelling", () => {
    expect(eventOp(DOCS("sets", "update"))).toBe("update");
    expect(eventOp(ROWS("set_comments", "create"))).toBe("create");
    expect(eventOp("")).toBe("");
  });
});

describe("classifyEvent: a clip", () => {
  it("is a clip on a set create, with no freshness check needed", () => {
    expect(classifyEvent(DOCS("sets", "create"), set())).toEqual({
      kind: "clip",
      athleteId: A,
      setId: "set1",
      videoFileId: "file1",
      exerciseId: "ex_squat",
      needsFreshFile: false,
    });
  });

  it("is a clip on an update too, but one the caller must prove is new", () => {
    expect(classifyEvent(ROWS("sets", "update"), set())).toMatchObject({ kind: "clip", needsFreshFile: true });
  });

  it("reads the table from $collectionId when the payload uses the documents spelling", () => {
    const row = { ...set(), $tableId: undefined, $collectionId: "sets" };
    expect(classifyEvent(DOCS("sets", "update"), row).kind).toBe("clip");
  });

  it("skips a set with no clip, which is every set logged without one", () => {
    expect(classifyEvent(DOCS("sets", "update"), set({ video_file_id: null })).kind).toBe("skip");
    expect(classifyEvent(DOCS("sets", "create"), set({ video_file_id: "" })).kind).toBe("skip");
  });

  it("skips a delete", () => {
    expect(classifyEvent(DOCS("sets", "delete"), set()).kind).toBe("skip");
  });

  it("skips a forged set before validate-row has deleted it", () => {
    const forged = set({ $permissions: ['read("users")', `update("user:${STRANGER}")`] });
    expect(classifyEvent(DOCS("sets", "create"), forged)).toEqual({ kind: "skip", reason: "set fails the authorship check" });
  });
});

describe("classifyEvent: a reply", () => {
  it("is a reply when the athlete writes on their own set", () => {
    expect(classifyEvent(ROWS("set_comments", "create"), comment())).toEqual({
      kind: "reply",
      athleteId: A,
      setId: "set1",
      commentId: "c1",
      body: "Felt the hips shoot up",
    });
  });

  it("never notifies the coach of their own comment", () => {
    const coachs = comment({ author_id: C, $permissions: POLICIES.set_comments({ athleteId: A, authorId: C }) });
    expect(classifyEvent(DOCS("set_comments", "create"), coachs).kind).toBe("skip");
  });

  it("skips an edit or a withdrawal: only a new reply is news", () => {
    expect(classifyEvent(DOCS("set_comments", "update"), comment()).kind).toBe("skip");
    expect(classifyEvent(DOCS("set_comments", "delete"), comment()).kind).toBe("skip");
  });

  it("skips a forged reply", () => {
    const forged = comment({ $permissions: ['read("users")', `update("user:${STRANGER}")`] });
    expect(classifyEvent(DOCS("set_comments", "create"), forged).kind).toBe("skip");
  });
});

describe("classifyEvent: everything else", () => {
  it.each(["comment_reactions", "set_reviews", "bodyweight_entries", "push_subscriptions", ""])("never notifies on %s", (table) => {
    const row = { $id: "r", $tableId: table, athlete_id: A, author_id: A, video_file_id: "f" };
    expect(classifyEvent(DOCS(table, "create"), row).kind).toBe("skip");
  });
});

describe("isFreshClip", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("counts a file made just before the attach", () => {
    expect(isFreshClip(ago(5_000), now)).toBe(true);
    expect(isFreshClip(ago(CLIP_FRESH_MS), now)).toBe(true);
  });

  it("does not count an old clip on a set edited later", () => {
    expect(isFreshClip(ago(CLIP_FRESH_MS + 1), now)).toBe(false);
    expect(isFreshClip(ago(24 * 60 * 60_000), now)).toBe(false);
  });

  it("tolerates a little clock skew but not a date from the future", () => {
    expect(isFreshClip(ago(-30_000), now)).toBe(true);
    expect(isFreshClip(ago(-5 * 60_000), now)).toBe(false);
  });

  it("treats an unreadable file as not new: silence beats a wrong buzz", () => {
    expect(isFreshClip(null, now)).toBe(false);
    expect(isFreshClip("not a date", now)).toBe(false);
  });
});

describe("recipientsFor", () => {
  const link = (coach_id: string, over: Record<string, unknown> = {}) => ({ coach_id, athlete_id: A, status: "active", ...over });

  it("is every coach on an active link", () => {
    expect(recipientsFor([link(C), link("coach_louis")], A)).toEqual([C, "coach_louis"]);
  });

  it("drops a revoked link", () => {
    expect(recipientsFor([link(C, { status: "revoked" })], A)).toEqual([]);
  });

  it("never tells a self-coached athlete about themselves", () => {
    expect(recipientsFor([link(A), link(C)], A)).toEqual([C]);
  });

  it("ignores a row for another athlete, should the query ever drop its filter", () => {
    expect(recipientsFor([link(C, { athlete_id: "athlete_b" })], A)).toEqual([]);
  });

  it("names each coach once", () => {
    expect(recipientsFor([link(C), link(C)], A)).toEqual([C]);
  });

  it("skips a link with no coach id", () => {
    expect(recipientsFor([link("")], A)).toEqual([]);
  });
});
