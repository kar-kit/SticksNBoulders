import { setPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { fetchSetsForSessions, sessionHasSets } from "./history-store";

/**
 * History's set read against a fake that applies limit and cursor as Appwrite
 * does. A powerlifting session with warm-ups runs to 30 sets, and History and
 * the coach's Athlete View both ask for 25 sessions at once.
 */

const db = vi.hoisted(() => ({ tables: null as FakeTables | null }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", tables: db.tables! }),
}));

const pad = (i: number) => String(i).padStart(4, "0");

const set = (id: string, sessionId: string, athleteId = "joey", index = 1): FakeRow => ({
  $id: id,
  $permissions: setPermissions({ athleteId }),
  athlete_id: athleteId,
  session_id: sessionId,
  exercise_id: "squat",
  client_set_id: id,
  set_index: index,
  load_kg: 180,
  reps: 3,
  rpe: 8,
  is_warmup: false,
  e1rm_kg: 196,
  logged_at: "2026-10-06T18:00:00.000Z",
});

beforeEach(() => {
  db.tables = new FakeTables();
});

describe("fetchSetsForSessions", () => {
  it("returns every set of 25 thirty-set sessions (750 rows), not the first page", async () => {
    const sessionIds = Array.from({ length: 25 }, (_, s) => `s${pad(s)}`);
    const rows: FakeRow[] = [];
    sessionIds.forEach((sessionId, s) => {
      for (let i = 0; i < 30; i++) rows.push(set(`x${pad(s * 30 + i)}`, sessionId, "joey", i + 1));
    });
    db.tables!.seed("sets", rows);

    const sets = await fetchSetsForSessions(sessionIds);

    expect(sets).toHaveLength(750);
    expect(new Set(sets.map((s) => s.clientSetId)).size).toBe(750);
    // Every session has all thirty.
    for (const sessionId of sessionIds) {
      expect(sets.filter((s) => s.sessionId === sessionId)).toHaveLength(30);
    }
  });

  it("asks only for the requested sessions and stops on a short page", async () => {
    db.tables!.seed("sets", [set("a1", "s1"), set("a2", "s2"), set("a3", "s3")]);

    const sets = await fetchSetsForSessions(["s1", "s3"]);

    expect(sets.map((s) => s.clientSetId).sort()).toEqual(["a1", "a3"]);
    expect(db.tables!.callsTo("sets")).toHaveLength(1);
  });

  it("asks nothing for no sessions", async () => {
    expect(await fetchSetsForSessions([])).toEqual([]);
    expect(db.tables!.calls).toHaveLength(0);
  });
});

describe("sessionHasSets", () => {
  it("says whether any set the athlete wrote still names the session", async () => {
    db.tables!.seed("sets", [set("st-1", "s1")]);
    expect(await sessionHasSets("s1")).toBe(true);
    expect(await sessionHasSets("s2")).toBe(false);
  });

  it("ignores a forged set, so a stranger cannot keep someone's session from being deleted", async () => {
    db.tables!.seed("sets", [{ ...set("st-x", "s1"), $permissions: setPermissions({ athleteId: "stranger" }) }]);
    expect(await sessionHasSets("s1")).toBe(false);
  });
});

describe("a set's clip", () => {
  it("comes back with the set, so deleting it from History can take the file too", async () => {
    db.tables!.seed("sets", [{ ...set("st-1", "s1"), video_file_id: "vid-1" }, set("st-2", "s1")]);
    const sets = await fetchSetsForSessions(["s1"]);
    expect(sets.map((each) => each.videoFileId)).toEqual(["vid-1", null]);
  });

  it("brings the clip's poster for the row's thumbnail, only when it is this clip's (F12)", async () => {
    db.tables!.seed("sets", [
      { ...set("st-1", "s1"), video_file_id: "vid-1", video_poster_id: "vid-1_poster" },
      { ...set("st-2", "s1", "joey", 2), video_file_id: "vid-2", video_poster_id: "vid-1_poster" },
    ]);
    const sets = await fetchSetsForSessions(["s1"]);
    expect(sets.map((each) => each.videoPosterId)).toEqual(["vid-1_poster", null]);
  });
});

describe("a set's note (F11)", () => {
  it("comes back with the set, and a blank one as none", async () => {
    db.tables!.seed("sets", [
      { ...set("st-1", "s1"), notes: "Hip pinched" },
      { ...set("st-2", "s1", "joey", 2), notes: "   " },
      set("st-3", "s1", "joey", 3),
    ]);
    const sets = await fetchSetsForSessions(["s1"]);
    expect(sets.map((each) => each.notes)).toEqual(["Hip pinched", null, null]);
  });
});
