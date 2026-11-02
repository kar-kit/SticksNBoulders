import { reactionPermissions } from "@/appwrite/documents/policy";
import type { Comment } from "./comments";
import { fetchReactionsForSets, sendReaction } from "./reaction-store";

/**
 * The reaction store against a fake Appwrite (F25): the batching that keeps a
 * thread to one reaction query, and what each tap sends -- including the one
 * conflict that is not a failure.
 */

// Spies under their own names: the store reaches them through the write
// helper's browser writer, which is the path under test.
const fake = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: { listRows: fake.list, createRow: fake.create, updateRow: fake.update, deleteRow: fake.remove },
  }),
}));

const JOEY = "joey";
const RUAIRI = "ruairi";

const coachComment: Comment = {
  id: "c1",
  setId: "s1",
  athleteId: JOEY,
  authorId: RUAIRI,
  body: "Brace harder.",
  parentId: null,
  createdAt: "2026-11-01T18:00:00.000Z",
};

const row = (id: string, setId: string, over: Record<string, unknown> = {}) => ({
  $id: id,
  comment_id: "c1",
  set_id: setId,
  athlete_id: JOEY,
  author_id: JOEY,
  emoji: "👍",
  created_at: "2026-11-01T18:05:00.000Z",
  $permissions: reactionPermissions({ athleteId: JOEY, authorId: JOEY }),
  ...over,
});

const conflict = () => Object.assign(new Error("Document with the requested ID already exists."), { code: 409 });

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset();
  fake.list.mockResolvedValue({ rows: [], total: 0 });
  fake.create.mockImplementation(async ({ rowId, data }) => ({ $id: rowId, ...data }));
  fake.update.mockImplementation(async ({ rowId }) => ({ $id: rowId }));
  fake.remove.mockResolvedValue({});
});

describe("fetchReactionsForSets", () => {
  it("reads every set's reactions in one query per hundred sets, never one per comment", async () => {
    const setIds = Array.from({ length: 150 }, (_, i) => `s${i}`);
    await fetchReactionsForSets([...setIds, "s0", ""]);
    expect(fake.list).toHaveBeenCalledTimes(2);
    const first = fake.list.mock.calls[0][0];
    expect(first.tableId).toBe("comment_reactions");
    const equal = JSON.parse(first.queries[0]) as { method: string; attribute: string; values: string[] };
    expect(equal).toMatchObject({ method: "equal", attribute: "set_id" });
    expect(equal.values).toHaveLength(100);
  });

  it("asks for nothing when there are no sets", async () => {
    expect(await fetchReactionsForSets([])).toEqual([]);
    expect(fake.list).not.toHaveBeenCalled();
  });

  it("keeps only what its author stamped, with one of the six", async () => {
    fake.list.mockResolvedValue({
      rows: [
        row("real", "s1"),
        row("forged", "s1", { $permissions: ['read("users")'] }),
        row("off-list", "s1", { emoji: "🍆" }),
      ],
    });
    expect((await fetchReactionsForSets(["s1"])).map((r) => r.id)).toEqual(["real"]);
  });
});

describe("sendReaction", () => {
  it("creates at the client id the screen already drew, stamped for the circle by the reactor", async () => {
    const outcome = await sendReaction({ plan: { kind: "create", emoji: "💪" }, comment: coachComment, viewerId: JOEY, newId: "new-1" });
    expect(fake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: "comment_reactions",
        rowId: "new-1",
        data: expect.objectContaining({ comment_id: "c1", set_id: "s1", athlete_id: JOEY, author_id: JOEY, emoji: "💪" }),
        permissions: reactionPermissions({ athleteId: JOEY, authorId: JOEY }),
      }),
    );
    expect(outcome).toMatchObject({ ok: true, reaction: { id: "new-1", emoji: "💪" } });
  });

  it("changes the same row when another emoji replaces it", async () => {
    const outcome = await sendReaction({ plan: { kind: "change", rowId: "r1", emoji: "🔥" }, comment: coachComment, viewerId: JOEY, newId: "unused" });
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({ tableId: "comment_reactions", rowId: "r1", data: { emoji: "🔥" } }));
    expect(fake.create).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true, reaction: null });
  });

  it("deletes it when the same emoji is tapped again, and a row already gone is the outcome asked for", async () => {
    expect(await sendReaction({ plan: { kind: "remove", rowId: "r1" }, comment: coachComment, viewerId: JOEY, newId: "unused" })).toEqual({ ok: true, reaction: null });
    fake.remove.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: 404 }));
    expect(await sendReaction({ plan: { kind: "remove", rowId: "r1" }, comment: coachComment, viewerId: JOEY, newId: "unused" })).toEqual({ ok: true, reaction: null });
  });

  it("answers the unique index by changing the reaction this person already left from another device", async () => {
    fake.create.mockRejectedValueOnce(conflict());
    fake.list.mockResolvedValueOnce({ rows: [row("other-device", "s1", { emoji: "👍" })] });
    const outcome = await sendReaction({ plan: { kind: "create", emoji: "😂" }, comment: coachComment, viewerId: JOEY, newId: "new-1" });

    const lookup = fake.list.mock.calls[0][0].queries.map((q: string) => JSON.parse(q));
    expect(lookup).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "equal", attribute: "comment_id", values: ["c1"] }),
        expect.objectContaining({ method: "equal", attribute: "author_id", values: [JOEY] }),
      ]),
    );
    expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({ rowId: "other-device", data: { emoji: "😂" } }));
    expect(outcome).toMatchObject({ ok: true, reaction: { id: "other-device", emoji: "😂" } });
  });

  it("fails, for the screen to revert, on any other refusal", async () => {
    fake.create.mockRejectedValueOnce(Object.assign(new Error("no"), { code: 401 }));
    expect(await sendReaction({ plan: { kind: "create", emoji: "👍" }, comment: coachComment, viewerId: JOEY, newId: "n" })).toEqual({ ok: false });
    fake.update.mockRejectedValueOnce(new Error("offline"));
    expect(await sendReaction({ plan: { kind: "change", rowId: "r1", emoji: "👍" }, comment: coachComment, viewerId: JOEY, newId: "n" })).toEqual({ ok: false });
  });

  it("fails without writing when asked to react to the viewer's own message", async () => {
    expect(await sendReaction({ plan: { kind: "create", emoji: "👍" }, comment: coachComment, viewerId: RUAIRI, newId: "n" })).toEqual({ ok: false });
    expect(fake.create).not.toHaveBeenCalled();
  });
});
