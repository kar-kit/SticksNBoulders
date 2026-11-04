import { POLICIES } from "@/appwrite/documents/policy";
import { deliver, outcomeFor, targetOf, type PushTarget, type Send } from "./deliver";
import { dispatch } from "./dispatch";
import { testMessage, type PushMessage } from "./message";
import { fakeTables } from "./test-kit";

const A = "athlete_a";
const C = "coach_c";
const L = "coach_louis";
const NOW = new Date("2026-11-04T12:00:00Z");
const JUST_NOW = new Date(NOW.getTime() - 20_000).toISOString();
const LAST_WEEK = new Date(NOW.getTime() - 7 * 24 * 60 * 60_000).toISOString();

const device = (id: string, userId: string, over: Record<string, unknown> = {}) => ({
  $id: id,
  user_id: userId,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: "B".repeat(87),
  auth: "a".repeat(22),
  notify_clips: true,
  notify_replies: true,
  ...over,
});

const set = (over: Record<string, unknown> = {}) => ({
  $id: "set1",
  $tableId: "sets",
  $databaseId: "sticksnboulders",
  athlete_id: A,
  exercise_id: "ex_squat",
  video_file_id: "file1",
  $permissions: POLICIES.sets({ athleteId: A }),
  ...over,
});

const reply = (over: Record<string, unknown> = {}) => ({
  $id: "c1",
  $tableId: "set_comments",
  set_id: "set1",
  athlete_id: A,
  author_id: A,
  parent_id: "c0",
  body: "Felt good",
  $permissions: POLICIES.set_comments({ athleteId: A, authorId: A }),
  ...over,
});

const UPDATE = "databases.sticksnboulders.collections.sets.documents.set1.update";
const CREATE = "databases.sticksnboulders.tables.sets.rows.set1.create";
const COMMENT = "databases.sticksnboulders.collections.set_comments.documents.c1.create";

function setup(opts: { links?: Array<Record<string, unknown>>; devices?: Array<Record<string, unknown>>; status?: Record<string, number> } = {}) {
  const db = fakeTables(
    {
      coach_athlete_links: (opts.links ?? [{ $id: "l1", coach_id: C, athlete_id: A, status: "active" }]).map((l, i) => ({ $id: `l${i}`, ...l })),
      push_subscriptions: opts.devices ?? [device("phone", C)],
      profiles: [{ $id: A, display_name: "Joey" }],
      exercises: [{ $id: "ex_squat", name: "Squat" }],
    },
    { file1: JUST_NOW, old: LAST_WEEK },
  );
  const sent: Array<{ target: PushTarget; message: PushMessage }> = [];
  const send: Send = async (target, payload) => {
    sent.push({ target, message: JSON.parse(payload) as PushMessage });
    return { statusCode: opts.status?.[target.rowId] ?? 201 };
  };
  const deps = { reader: db.reader, write: db.write(NOW), send, now: () => NOW, log: () => {} };
  return { db, sent, deps };
}

describe("dispatch: a clip", () => {
  it("tells the athlete's coach, on every device that wants clips", async () => {
    const { sent, deps } = setup({ devices: [device("phone", C), device("laptop", C), device("muted", C, { notify_clips: false })] });
    const result = await dispatch(deps, UPDATE, set());
    expect(result).toMatchObject({ action: "sent", kind: "clip", recipients: 1, devices: 2, delivered: 2 });
    expect(sent.map((s) => s.target.rowId).sort()).toEqual(["laptop", "phone"]);
    expect(sent[0].message).toMatchObject({ title: "Joey uploaded a clip", body: "Squat · ready to review", tag: `clips:${A}`, key: "set1:file1" });
  });

  it("tells every active coach, and only them", async () => {
    const { sent, deps } = setup({
      links: [
        { coach_id: C, athlete_id: A, status: "active" },
        { coach_id: L, athlete_id: A, status: "active" },
        { coach_id: "coach_former", athlete_id: A, status: "revoked" },
      ],
      devices: [device("c", C), device("l", L), device("f", "coach_former"), device("stranger", "user_x")],
    });
    await dispatch(deps, UPDATE, set());
    expect(sent.map((s) => s.target.userId).sort()).toEqual([C, L]);
  });

  it("does not buzz for an edit to a set whose clip is old", async () => {
    const { sent, deps } = setup();
    expect(await dispatch(deps, UPDATE, set({ video_file_id: "old" }))).toEqual({ action: "skip", reason: "set updated, clip is not new" });
    expect(sent).toEqual([]);
  });

  it("does not need the file check for a set created with its clip", async () => {
    const { sent, deps } = setup();
    await dispatch(deps, CREATE, set({ video_file_id: "old" }));
    expect(sent).toHaveLength(1);
  });

  it("never notifies a self-coached athlete about their own clip", async () => {
    const { sent, deps } = setup({ links: [{ coach_id: A, athlete_id: A, status: "active" }], devices: [device("own", A)] });
    expect(await dispatch(deps, UPDATE, set())).toEqual({ action: "skip", reason: "no active coach to tell" });
    expect(sent).toEqual([]);
  });

  it("says so when no coach device wants it", async () => {
    const { deps } = setup({ devices: [device("muted", C, { notify_clips: false })] });
    expect(await dispatch(deps, UPDATE, set())).toMatchObject({ action: "skip" });
  });
});

describe("dispatch: a reply", () => {
  it("tells the coach, with the reply as the body", async () => {
    const { sent, deps } = setup();
    const result = await dispatch(deps, COMMENT, reply());
    expect(result).toMatchObject({ action: "sent", kind: "reply" });
    expect(sent[0].message).toMatchObject({ title: "Joey replied", body: "Felt good", key: "c1", tag: `replies:${A}` });
  });

  it("respects the replies switch", async () => {
    const { sent, deps } = setup({ devices: [device("phone", C, { notify_replies: false })] });
    await dispatch(deps, COMMENT, reply());
    expect(sent).toEqual([]);
  });

  it("never tells the coach about their own comment", async () => {
    const { sent, deps } = setup();
    await dispatch(deps, COMMENT, reply({ author_id: C, $permissions: POLICIES.set_comments({ athleteId: A, authorId: C }) }));
    expect(sent).toEqual([]);
  });

  it("never fires on a reaction", async () => {
    const { sent, deps } = setup();
    const reaction = { $id: "r1", $tableId: "comment_reactions", athlete_id: A, author_id: A, emoji: "👍" };
    await dispatch(deps, "databases.sticksnboulders.tables.comment_reactions.rows.r1.create", reaction);
    expect(sent).toEqual([]);
  });

  it("works without a profile name", async () => {
    const { db, sent, deps } = setup();
    db.tables.profiles = [];
    await dispatch(deps, COMMENT, reply());
    expect(sent[0].message.title).toBe("Your athlete replied");
  });
});

describe("dispatch: cleanup", () => {
  it("removes a device the push service says is gone, keeps one that merely failed, and stamps the one that worked", async () => {
    const { db, deps } = setup({
      devices: [device("gone404", C), device("gone410", C), device("flaky", C), device("fine", C)],
      status: { gone404: 404, gone410: 410, flaky: 503 },
    });
    const result = await dispatch(deps, UPDATE, set());
    expect(result).toMatchObject({ delivered: 1, removed: 2, failed: 1 });
    expect(db.tables.push_subscriptions.map((r) => r.$id).sort()).toEqual(["fine", "flaky"]);
    const stamp = db.writes.find((w) => w.op === "update" && w.rowId === "fine")!;
    expect(stamp.data).toEqual({ last_success_at: NOW.toISOString() });
    expect(stamp.permissions).toEqual(POLICIES.push_subscriptions({ userId: C }));
  });
});

describe("deliver", () => {
  it("maps push service answers to what happens to the row", () => {
    expect(outcomeFor(201)).toBe("delivered");
    expect(outcomeFor(404)).toBe("gone");
    expect(outcomeFor(410)).toBe("gone");
    for (const code of [0, 400, 403, 413, 429, 500]) expect(outcomeFor(code), String(code)).toBe("failed");
  });

  it("counts a send that throws as failed and keeps the row", async () => {
    const db = fakeTables({ push_subscriptions: [device("phone", C)] });
    const target = targetOf(device("phone", C))!;
    const result = await deliver(
      { send: async () => Promise.reject(new Error("ECONNRESET")), write: db.write(NOW), log: () => {} },
      [target],
      testMessage(NOW),
    );
    expect(result).toEqual({ delivered: 0, removed: 0, failed: 1 });
    expect(db.tables.push_subscriptions).toHaveLength(1);
  });

  it("does not fail the send when the bookkeeping does", async () => {
    const db = fakeTables({ push_subscriptions: [] });
    const result = await deliver({ send: async () => ({ statusCode: 201 }), write: db.write(NOW), log: () => {} }, [targetOf(device("ghost", C))!], testMessage(NOW));
    expect(result.delivered).toBe(1);
  });

  it("will not target a row missing a field", () => {
    expect(targetOf({ ...device("x", C), auth: "" })).toBeNull();
  });
});
