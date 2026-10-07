import { commentPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { fetchCommentsForAthlete, fetchCommentsForSets } from "./comment-store";

/**
 * Comment reads against a fake Appwrite that applies the filters and the
 * order, so "oldest first in a thread" and "newest first on the Athlete View"
 * are each a query the test can see go wrong.
 */

const db = vi.hoisted(() => ({ current: null as FakeTables | null }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", tables: db.current! }),
}));

const comment = (id: string, setId: string, authorId: string, createdAt: string, over: Partial<FakeRow> = {}): FakeRow => ({
  $id: id,
  $permissions: commentPermissions({ athleteId: "joey", authorId }),
  set_id: setId,
  athlete_id: "joey",
  author_id: authorId,
  body: `${authorId} on ${setId}`,
  parent_id: null,
  created_at: createdAt,
  ...over,
});

beforeEach(() => {
  db.current = new FakeTables();
});

describe("fetchCommentsForSets", () => {
  it("returns a thread in the order it was said, whatever the ids", async () => {
    // Ids out of time order on purpose: both parties write here, and the
    // athlete's reply can carry a smaller id than the coach's opener.
    db.current!.seed("set_comments", [
      comment("b-reply", "s1", "joey", "2026-10-06T19:05:00.000Z", { parent_id: "z-open" }),
      comment("z-open", "s1", "ruairi", "2026-10-06T19:00:00.000Z"),
      comment("a-later", "s1", "ruairi", "2026-10-06T19:10:00.000Z"),
      comment("other", "s9", "ruairi", "2026-10-06T18:00:00.000Z"),
    ]);

    const thread = await fetchCommentsForSets(["s1"]);
    expect(thread.map((c) => c.id)).toEqual(["z-open", "b-reply", "a-later"]);
    expect(thread[1]).toMatchObject({ parentId: "z-open", authorId: "joey", body: "joey on s1" });
  });

  it("drops a comment whose author did not write it", async () => {
    // author_id says Ruairi; the stamp says anyone could have.
    const forged = comment("forged", "s1", "ruairi", "2026-10-06T19:01:00.000Z", {
      $permissions: ['read("users")'],
      body: "Your coach says skip deload",
    });
    db.current!.seed("set_comments", [comment("real", "s1", "ruairi", "2026-10-06T19:00:00.000Z"), forged]);

    expect((await fetchCommentsForSets(["s1"])).map((c) => c.id)).toEqual(["real"]);
  });

  it("drops a row with nothing said", async () => {
    db.current!.seed("set_comments", [
      comment("empty", "s1", "ruairi", "2026-10-06T19:00:00.000Z", { body: "" }),
      comment("said", "s1", "ruairi", "2026-10-06T19:01:00.000Z"),
    ]);
    expect((await fetchCommentsForSets(["s1"])).map((c) => c.id)).toEqual(["said"]);
  });

  it("asks once for up to a hundred sets", async () => {
    const setIds = Array.from({ length: 100 }, (_, i) => `s${i}`);
    db.current!.seed("set_comments", [comment("c", "s99", "ruairi", "2026-10-06T19:00:00.000Z")]);
    expect((await fetchCommentsForSets([...setIds, "s1", ""])).map((c) => c.id)).toEqual(["c"]);
    expect(db.current!.callsTo("set_comments")).toHaveLength(1);
  });
});

describe("fetchCommentsForAthlete", () => {
  it("is the athlete's newest comments first, capped at the limit", async () => {
    db.current!.seed("set_comments", [
      comment("old", "s1", "ruairi", "2026-10-01T10:00:00.000Z"),
      comment("new", "s2", "ruairi", "2026-10-06T10:00:00.000Z"),
      comment("mid", "s3", "joey", "2026-10-03T10:00:00.000Z"),
      { ...comment("theirs", "s4", "ruairi", "2026-10-07T10:00:00.000Z"), athlete_id: "brandon", $permissions: commentPermissions({ athleteId: "brandon", authorId: "ruairi" }) },
    ]);

    expect((await fetchCommentsForAthlete("joey", 2)).map((c) => c.id)).toEqual(["new", "mid"]);
  });

  it("drops a forged comment", async () => {
    db.current!.seed("set_comments", [
      comment("real", "s1", "ruairi", "2026-10-01T10:00:00.000Z"),
      comment("forged", "s1", "ruairi", "2026-10-02T10:00:00.000Z", { $permissions: ['read("users")'] }),
    ]);
    expect((await fetchCommentsForAthlete("joey")).map((c) => c.id)).toEqual(["real"]);
  });
});
