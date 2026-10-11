import { setPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { fetchSetsForSessions } from "./history-store";

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
