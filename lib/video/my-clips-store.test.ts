import { setPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { deleteMyClip, fetchMyClip, fetchMyClips, retireReplacedClip } from "./my-clips-store";

/**
 * The athlete's own clips (F13) against a fake Appwrite that applies the
 * queries, so the owner filter, the order, the lift filter and the cursor are
 * each something a test can see go missing.
 */

const db = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", tables: db.current }),
}));

const enqueue = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/offline/client", () => ({ enqueue }));

const tables = () => db.current as FakeTables;

/** A filmed set, stamped as the athlete's own write would be. */
const clip = (id: string, athleteId: string, day: number, over: Partial<FakeRow> = {}): FakeRow => ({
  $id: id,
  $permissions: setPermissions({ athleteId }),
  athlete_id: athleteId,
  exercise_id: "squat",
  session_id: "s1",
  set_index: 1,
  load_kg: 180,
  reps: 3,
  rpe: 8,
  is_warmup: false,
  logged_at: `2026-10-${String(day).padStart(2, "0")}T18:00:00.000Z`,
  video_file_id: `file-${id}`,
  ...over,
});

beforeEach(() => {
  db.current = new FakeTables();
  enqueue.mockClear();
});

describe("fetchMyClips", () => {
  it("returns only this athlete's filmed sets, newest first", async () => {
    tables().seed("sets", [
      clip("a", "joey", 1),
      clip("b", "joey", 3),
      // A set Joey can read because he coaches Sam. Not his clip.
      clip("sam", "sam", 4),
      // Not filmed.
      clip("c", "joey", 5, { video_file_id: null }),
    ]);
    const page = await fetchMyClips({ athleteId: "joey" });
    expect(page.clips.map((c) => c.id)).toEqual(["b", "a"]);
    expect(page.cursor).toBeNull();
  });

  it("drops a row claiming to be the athlete's that somebody else wrote", async () => {
    tables().seed("sets", [
      clip("mine", "joey", 1),
      clip("forged", "joey", 2, { $permissions: setPermissions({ athleteId: "mallory" }) }),
    ]);
    const page = await fetchMyClips({ athleteId: "joey" });
    expect(page.clips.map((c) => c.id)).toEqual(["mine"]);
  });

  it("filters by lift on the server, not over the page already read", async () => {
    tables().seed("sets", [
      clip("s1", "joey", 9),
      clip("b1", "joey", 8, { exercise_id: "bench" }),
      clip("s2", "joey", 1),
    ]);
    const page = await fetchMyClips({ athleteId: "joey", exerciseId: "squat", limit: 1 });
    expect(page.clips.map((c) => c.id)).toEqual(["s1"]);
    const next = await fetchMyClips({ athleteId: "joey", exerciseId: "squat", cursor: page.cursor, limit: 1 });
    expect(next.clips.map((c) => c.id)).toEqual(["s2"]);
    const [query] = tables().callsTo("sets");
    expect(query.queries).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "equal", attribute: "exercise_id", values: ["squat"] })]),
    );
  });

  it("pages on a cursor, and hands one back only while a page came back full", async () => {
    tables().seed(
      "sets",
      Array.from({ length: 5 }, (_, i) => clip(`c${i}`, "joey", i + 1)),
    );
    const first = await fetchMyClips({ athleteId: "joey", limit: 2 });
    expect(first.clips.map((c) => c.id)).toEqual(["c4", "c3"]);
    expect(first.cursor).toBe("c3");
    const second = await fetchMyClips({ athleteId: "joey", limit: 2, cursor: first.cursor });
    expect(second.clips.map((c) => c.id)).toEqual(["c2", "c1"]);
    const third = await fetchMyClips({ athleteId: "joey", limit: 2, cursor: second.cursor });
    expect(third.clips.map((c) => c.id)).toEqual(["c0"]);
    expect(third.cursor).toBeNull();
  });

  it("moves past a page whose last row was dropped", async () => {
    tables().seed("sets", [
      clip("new", "joey", 3),
      clip("forged", "joey", 2, { $permissions: setPermissions({ athleteId: "mallory" }) }),
      clip("old", "joey", 1),
    ]);
    const first = await fetchMyClips({ athleteId: "joey", limit: 2 });
    expect(first.clips.map((c) => c.id)).toEqual(["new"]);
    expect(first.cursor).toBe("forged");
    const second = await fetchMyClips({ athleteId: "joey", limit: 2, cursor: first.cursor });
    expect(second.clips.map((c) => c.id)).toEqual(["old"]);
  });

  it("reads the warm-up flag, so a note edit cannot turn a filmed warm-up into a working set", async () => {
    tables().seed("sets", [clip("w", "joey", 1, { is_warmup: true })]);
    const [warmup] = (await fetchMyClips({ athleteId: "joey" })).clips;
    expect(warmup.isWarmup).toBe(true);
  });

  it("asks for nothing without an athlete", async () => {
    expect(await fetchMyClips({ athleteId: "" })).toEqual({ clips: [], cursor: null });
    expect(tables().calls).toHaveLength(0);
  });
});

describe("fetchMyClip", () => {
  it("opens the athlete's own clip", async () => {
    tables().seed("sets", [clip("a", "joey", 1, { notes: "left hip" })]);
    const found = await fetchMyClip("joey", "a");
    expect(found).toMatchObject({ id: "a", videoFileId: "file-a", notes: "left hip" });
  });

  it("refuses a set the athlete can read but does not own (a coach who also trains)", async () => {
    tables().seed("sets", [clip("sams", "sam", 1)]);
    expect(await fetchMyClip("joey", "sams")).toBeNull();
  });

  it("reads a set with no clip, or no set at all, as nothing", async () => {
    tables().seed("sets", [clip("bare", "joey", 1, { video_file_id: null })]);
    expect(await fetchMyClip("joey", "bare")).toBeNull();
    expect(await fetchMyClip("joey", "gone")).toBeNull();
  });
});

describe("deleteMyClip", () => {
  it("queues the detach first, then the file's delete behind it", async () => {
    await deleteMyClip("st-1", "file-1");
    expect(enqueue.mock.calls).toEqual([
      ["set.attachVideo", { setId: "st-1", videoFileId: null, videoPosterId: null }],
      ["clip.delete", { setId: "st-1", fileId: "file-1" }],
    ]);
  });
});

describe("retireReplacedClip", () => {
  it("queues the old file's delete", async () => {
    await retireReplacedClip("st-1", "file-old");
    expect(enqueue.mock.calls).toEqual([["clip.delete", { setId: "st-1", fileId: "file-old" }]]);
  });
});
