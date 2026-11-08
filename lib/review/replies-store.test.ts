import { commentPermissions, setPermissions, threadReadPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { fetchSetOwner, fetchThreadComments, fetchThreadReads, fetchThreadSets, subscribeToThreads } from "./replies-store";

/**
 * The Replies inbox's reads against a fake Appwrite that applies the queries,
 * so the athlete filter, the forgery filter and the channel list are each
 * something a test can see go missing.
 */

type Listener = (message: { events?: string[] }) => void;

const db = vi.hoisted(() => ({
  current: null as FakeTables | null,
  getRow: vi.fn(),
  channels: [] as { channels: string | string[]; listener: Listener }[],
}));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: Object.assign(db.current!, { getRow: db.getRow }),
    client: {
      subscribe: (channels: string | string[], listener: Listener) => {
        db.channels.push({ channels, listener });
        return () => {};
      },
    },
  }),
}));

const comment = (id: string, athleteId: string, authorId: string, over: Partial<FakeRow> = {}): FakeRow => ({
  $id: id,
  $createdAt: "2026-11-01T10:00:00.000+00:00",
  $permissions: commentPermissions({ athleteId, authorId }),
  set_id: "s1",
  athlete_id: athleteId,
  author_id: authorId,
  body: "Felt it.",
  parent_id: null,
  created_at: "2026-11-01T09:00:00.000Z",
  client_comment_id: id,
  ...over,
});

beforeEach(() => {
  db.current = new FakeTables();
  db.channels = [];
  db.getRow.mockReset();
});

describe("fetchThreadComments", () => {
  it("reads every linked athlete's threads in one IN query, newest first, the coach's words included", async () => {
    db.current!.seed("set_comments", [
      comment("a", "joey", "joey"),
      comment("b", "joey", "ruairi"),
      comment("c", "stranger", "stranger"),
    ]);
    const found = await fetchThreadComments(["joey", "sam"]);
    expect(found.map((c) => c.id).sort()).toEqual(["a", "b"]);
    const [call] = db.current!.callsTo("set_comments");
    expect(call.queries).toContainEqual(expect.objectContaining({ method: "equal", attribute: "athlete_id", values: ["joey", "sam"] }));
    expect(call.queries).toContainEqual(expect.objectContaining({ method: "orderDesc", attribute: "created_at" }));
  });

  it("carries the server's time on each comment, not only the writer's", async () => {
    db.current!.seed("set_comments", [comment("a", "joey", "joey")]);
    const [found] = await fetchThreadComments(["joey"]);
    expect(found.postedAt).toBe("2026-11-01T10:00:00.000+00:00");
    expect(found.createdAt).toBe("2026-11-01T09:00:00.000Z");
  });

  it("drops a reply forged in the athlete's name, which would light the badge", async () => {
    db.current!.seed("set_comments", [comment("f", "joey", "joey", { $permissions: ['read("users")'] })]);
    expect(await fetchThreadComments(["joey"])).toEqual([]);
  });

  it("asks nothing for a coach with nobody linked", async () => {
    expect(await fetchThreadComments([])).toEqual([]);
    expect(db.current!.calls).toEqual([]);
  });
});

describe("fetchThreadReads", () => {
  const mark = (setId: string, coachId: string, over: Partial<FakeRow> = {}): FakeRow => ({
    $id: `${coachId}_${setId}`,
    $permissions: threadReadPermissions({ coachId }),
    coach_id: coachId,
    athlete_id: "joey",
    set_id: setId,
    last_read_at: "2026-11-01T10:00:00.000Z",
    ...over,
  });

  it("reads this coach's marks by set", async () => {
    db.current!.seed("thread_reads", [mark("s1", "ruairi"), mark("s2", "louis")]);
    const marks = await fetchThreadReads("ruairi");
    expect([...marks.keys()]).toEqual(["s1"]);
    expect(marks.get("s1")).toEqual({ athleteId: "joey", lastReadAt: "2026-11-01T10:00:00.000Z" });
  });

  it("ignores a mark planted in his name, the way to silence his badge", async () => {
    db.current!.seed("thread_reads", [mark("s1", "ruairi", { $permissions: ['read("users")'] })]);
    expect((await fetchThreadReads("ruairi")).size).toBe(0);
  });
});

describe("subscribeToThreads", () => {
  it("listens to comments and the coach's own marks, and never to reactions", () => {
    subscribeToThreads("db", () => {});
    const [{ channels }] = db.channels;
    expect(channels).toEqual(["databases.db.tables.set_comments.rows", "databases.db.tables.thread_reads.rows"]);
    expect(JSON.stringify(channels)).not.toContain("comment_reactions");
  });

  it("wakes on a create, an update or a withdrawn reply", () => {
    const onChange = vi.fn();
    subscribeToThreads("db", onChange);
    const { listener } = db.channels[0];
    listener({ events: ["databases.db.tables.set_comments.rows.c1.create"] });
    listener({ events: ["databases.db.tables.set_comments.rows.c1.delete"] });
    listener({ events: ["databases.db.tables.thread_reads.rows.m1.update"] });
    listener({ events: [] });
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});

describe("fetchThreadSets", () => {
  it("reads the sets on screen by id, keeping only sets their athlete wrote", async () => {
    db.current!.seed("sets", [
      { $id: "s1", $permissions: setPermissions({ athleteId: "joey" }), athlete_id: "joey", exercise_id: "squat", load_kg: 180, reps: 3, rpe: 8, logged_at: "2026-10-30T18:00:00.000Z" },
      { $id: "s2", $permissions: ['read("users")'], athlete_id: "joey", exercise_id: "squat", load_kg: 300, reps: 1 },
    ]);
    const sets = await fetchThreadSets(["s1", "s2", "s1"]);
    expect([...sets.keys()]).toEqual(["s1"]);
    expect(sets.get("s1")).toEqual({ athleteId: "joey", exerciseId: "squat", loadKg: 180, reps: 3, rpe: 8, loggedAt: "2026-10-30T18:00:00.000Z", failed: false });
  });
});

describe("fetchSetOwner", () => {
  it("names the athlete of a set the coach can read", async () => {
    db.getRow.mockResolvedValue({ $id: "s1", $permissions: setPermissions({ athleteId: "joey" }), athlete_id: "joey" });
    expect(await fetchSetOwner("s1")).toBe("joey");
  });

  it("is null for a set he cannot read, and for one somebody forged", async () => {
    db.getRow.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: 404 }));
    expect(await fetchSetOwner("gone")).toBeNull();
    db.getRow.mockResolvedValueOnce({ $id: "f", $permissions: ['read("users")'], athlete_id: "joey" });
    expect(await fetchSetOwner("f")).toBeNull();
  });
});
