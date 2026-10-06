import { sessionPermissions, setPermissions } from "@/appwrite/documents/policy";
import { fetchTrainingLog, type RowReader } from "./training-log-store";

type Row = { $id: string } & Record<string, unknown>;

interface ParsedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

/**
 * An in-memory Appwrite that understands the handful of queries the store
 * sends: equal, limit, cursorAfter, orderAsc("$id") and select. Enough to
 * prove the store pages to the end and asks only for its athlete.
 */
function fakeReader(tables: Record<string, Row[]>) {
  const calls: Array<{ tableId: string; queries: ParsedQuery[] }> = [];
  const reader: RowReader = {
    async listRows({ tableId, queries = [] }) {
      const parsed = queries.map((q) => JSON.parse(q) as ParsedQuery);
      calls.push({ tableId, queries: parsed });
      let rows = [...(tables[tableId] ?? [])].sort((a, b) => a.$id.localeCompare(b.$id));
      for (const q of parsed) {
        if (q.method === "equal") rows = rows.filter((r) => q.values!.includes(r[q.attribute!]));
      }
      const cursor = parsed.find((q) => q.method === "cursorAfter")?.values?.[0];
      if (cursor) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
      const limit = Number(parsed.find((q) => q.method === "limit")?.values?.[0] ?? 25);
      return { rows: rows.slice(0, limit) };
    },
  };
  return { reader, calls };
}

const pad = (i: number) => String(i).padStart(5, "0");

function seed(athleteId: string, setCount: number): Row[] {
  return Array.from({ length: setCount }, (_, i) => ({
    $id: `${athleteId}-set-${pad(i)}`,
    // Stamped as the write helper would. The export trusts nothing else.
    $permissions: setPermissions({ athleteId }),
    athlete_id: athleteId,
    session_id: `${athleteId}-sess-${Math.floor(i / 20)}`,
    exercise_id: i % 2 ? "sq" : "bp",
    set_index: (i % 20) + 1,
    load_kg: 100,
    reps: 5,
    rpe: i % 3 ? 8 : null,
    is_warmup: i % 20 === 0,
    e1rm_kg: 120,
    logged_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    notes: null,
  }));
}

describe("fetchTrainingLog", () => {
  it("pages through every set, not the first 25 or 100", async () => {
    const sets = seed("ath", 1234);
    const sessions = Array.from({ length: 62 }, (_, i) => ({
      $id: `ath-sess-${i}`,
      $permissions: sessionPermissions({ athleteId: "ath" }),
      athlete_id: "ath",
      started_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      notes: null,
    }));
    const { reader, calls } = fakeReader({
      sets,
      sessions,
      exercises: [
        { $id: "sq", name: "Squat" },
        { $id: "bp", name: "Bench Press" },
      ],
    });

    const log = await fetchTrainingLog(reader, "db", "ath");
    expect(log.sets).toHaveLength(1234);
    expect(log.sessions).toHaveLength(62);
    expect(log.skipped).toBe(0);
    expect(new Set(log.sets.map((s) => s.id)).size).toBe(1234);
    expect(calls.filter((c) => c.tableId === "sets")).toHaveLength(3);
    expect(log.exerciseNames).toEqual(new Map([["sq", "Squat"], ["bp", "Bench Press"]]));
  });

  it("asks only for the requested athlete's rows, uncached, with a stable cursor order", async () => {
    const { reader, calls } = fakeReader({ sets: [...seed("ath", 3), ...seed("other", 3)], sessions: [] });
    const log = await fetchTrainingLog(reader, "db", "ath");
    expect(log.sets.every((s) => s.id.startsWith("ath-"))).toBe(true);

    for (const call of calls.filter((c) => c.tableId !== "exercises")) {
      expect(call.queries).toContainEqual(expect.objectContaining({ method: "equal", attribute: "athlete_id", values: ["ath"] }));
      expect(call.queries).toContainEqual(expect.objectContaining({ method: "orderAsc", attribute: "$id" }));
    }
  });

  it("parses the row into the export's shape", async () => {
    const { reader } = fakeReader({
      sets: [
        {
          $id: "x",
          $permissions: setPermissions({ athleteId: "ath" }),
          athlete_id: "ath",
          session_id: "s",
          exercise_id: "sq",
          set_index: 2,
          load_kg: 142.5,
          reps: 3,
          rpe: 8.5,
          is_warmup: null,
          e1rm_kg: null,
          logged_at: "2026-09-14T18:00:00.000+00:00",
          notes: "",
        },
      ],
      sessions: [
        {
          $id: "s",
          $permissions: sessionPermissions({ athleteId: "ath" }),
          athlete_id: "ath",
          started_at: "2026-09-14T17:30:00.000+00:00",
          notes: "PB day",
        },
      ],
    });
    const log = await fetchTrainingLog(reader, "db", "ath");
    expect(log.sets[0]).toEqual({
      id: "x",
      sessionId: "s",
      exerciseId: "sq",
      setIndex: 2,
      loadKg: 142.5,
      reps: 3,
      rpe: 8.5,
      isWarmup: false,
      e1rmKg: null,
      loggedAt: new Date("2026-09-14T18:00:00Z"),
      notes: null,
    });
    expect(log.sessions[0]).toEqual({ id: "s", startedAt: new Date("2026-09-14T17:30:00Z"), notes: "PB day" });
  });

  it("counts unreadable rows instead of dropping them silently", async () => {
    const good = seed("ath", 2);
    const { reader } = fakeReader({
      sets: [...good, { ...good[0], $id: "ath-bad", logged_at: "not a date" }],
      sessions: [
        { $id: "s", $permissions: sessionPermissions({ athleteId: "ath" }), athlete_id: "ath", started_at: "nope" },
      ],
    });
    const log = await fetchTrainingLog(reader, "db", "ath");
    expect(log.sets).toHaveLength(2);
    expect(log.skipped).toBe(2);
  });

  it("looks up names in batches small enough for a query string", async () => {
    const sets = Array.from({ length: 250 }, (_, i) => ({
      ...seed("ath", 1)[0],
      $id: `ath-set-${pad(i)}`,
      exercise_id: `ex-${pad(i)}`,
    }));
    const exercises = sets.map((s) => ({ $id: String(s.exercise_id), name: `Lift ${s.exercise_id}` }));
    const { reader, calls } = fakeReader({ sets, sessions: [], exercises });
    const log = await fetchTrainingLog(reader, "db", "ath");
    const nameCalls = calls.filter((c) => c.tableId === "exercises");
    expect(nameCalls).toHaveLength(3);
    expect(nameCalls.every((c) => (c.queries.find((q) => q.method === "equal")?.values ?? []).length <= 100)).toBe(true);
    expect(log.exerciseNames.size).toBe(250);
  });

  it("returns an empty log for someone who may read nothing", async () => {
    const { reader } = fakeReader({ sets: [], sessions: [] });
    const log = await fetchTrainingLog(reader, "db", "ath");
    expect(log).toEqual({ sessions: [], sets: [], exerciseNames: new Map(), skipped: 0 });
  });

  it("leaves out a set carrying the athlete's id that the athlete did not write", async () => {
    // The 27 Sep forgery: a stranger's row under this athlete's id, stamped
    // read("users"). It would otherwise land in the CSV as their lift.
    const sets = seed("ath", 3);
    const forged = { ...sets[0], $id: "forged", load_kg: 400, $permissions: ['read("users")'] };
    const { reader } = fakeReader({ sets: [...sets, forged], sessions: [], exercises: [] });

    const log = await fetchTrainingLog(reader, "db", "ath");
    expect(log.sets.map((s) => s.id)).not.toContain("forged");
    expect(log.sets).toHaveLength(3);
    expect(log.skipped).toBe(0);
  });
});
