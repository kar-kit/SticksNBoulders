import { setPermissions } from "@/appwrite/documents/policy";
import { fetchExerciseHistory, fetchSetsBefore } from "./exercise-history-store";

type Row = { $id: string } & Record<string, unknown>;

interface ParsedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

/**
 * An in-memory Appwrite that applies what the store sends: equal, lessThan,
 * orderAsc/orderDesc, cursorAfter, limit. It also records every request, so
 * the tests can hold the store to one read per exercise and to the index
 * it is meant to use. Provenance is real.
 */
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  requests: [] as { tableId: string; queries: ParsedQuery[] }[],
  fail: null as string | null,
}));

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: {
      listRows: async ({ tableId, queries = [] }: { tableId: string; queries?: string[] }) => {
        const parsed = queries.map((q) => JSON.parse(q) as ParsedQuery);
        db.requests.push({ tableId, queries: parsed });
        if (db.fail === tableId) throw new TypeError("Failed to fetch");
        let rows = [...(db.tables[tableId] ?? [])];
        for (const q of parsed) {
          if (q.method === "equal") rows = rows.filter((r) => q.values!.includes(r[q.attribute!]));
          if (q.method === "lessThan") rows = rows.filter((r) => String(r[q.attribute!]) < String(q.values![0]));
        }
        const order = parsed.find((q) => q.method === "orderAsc" || q.method === "orderDesc");
        if (order) {
          const key = order.attribute!;
          rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
          if (order.method === "orderDesc") rows.reverse();
        }
        const cursor = parsed.find((q) => q.method === "cursorAfter")?.values?.[0];
        if (cursor) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
        const limit = Number(parsed.find((q) => q.method === "limit")?.values?.[0] ?? 25);
        return { rows: rows.slice(0, limit) };
      },
    },
  }),
}));

// Thursday 22 Oct 2026, 18:00 London. Its week began Monday 19 Oct.
const sessionStart = new Date("2026-10-22T17:00:00Z");

let n = 0;
const setRow = (sessionId: string, iso: string, over: Record<string, unknown> = {}): Row => {
  n += 1;
  return {
    $id: `s-${String(n).padStart(5, "0")}`,
    $permissions: setPermissions({ athleteId: "joey" }),
    athlete_id: "joey",
    exercise_id: "squat",
    session_id: sessionId,
    client_set_id: `c-${n}`,
    set_index: n,
    load_kg: 100,
    reps: 5,
    rpe: null,
    is_warmup: false,
    e1rm_kg: null,
    logged_at: iso,
    ...over,
  };
};

const rollup = (iso: string, over: Record<string, unknown> = {}): Row => ({
  $id: `r-${iso}`,
  athlete_id: "joey",
  exercise_id: "squat",
  week_start: iso,
  best_e1rm_kg: null,
  best_single_kg: null,
  best_single_reps: null,
  best_reps: null,
  best_reps_load_kg: null,
  ...over,
});

beforeEach(() => {
  db.tables = {};
  db.requests = [];
  db.fail = null;
  n = 0;
});

describe("fetchExerciseHistory", () => {
  it("returns last session's sets, warm-ups included, and the bests from before today", async () => {
    db.tables.sets = [
      setRow("tue", "2026-10-20T18:00:00Z", { load_kg: 60, is_warmup: true }),
      setRow("tue", "2026-10-20T18:05:00Z", { load_kg: 150, reps: 3 }),
      setRow("tue", "2026-10-20T18:10:00Z", { load_kg: 140, reps: 5 }),
      setRow("fri", "2026-10-16T18:00:00Z", { load_kg: 130 }),
      // Today, already synced: neither last time nor a best to beat.
      setRow("now", "2026-10-22T17:20:00Z", { load_kg: 170, reps: 1 }),
    ];
    db.tables.stats_rollups = [
      rollup("2026-10-12T00:00:00.000Z", { best_e1rm_kg: 165, best_single_kg: 145 }),
      // This week's rollup already holds today's 170.
      rollup("2026-10-19T00:00:00.000Z", { best_e1rm_kg: 175, best_single_kg: 170 }),
    ];

    const history = await fetchExerciseHistory("joey", "squat", "now", sessionStart);
    expect(history.previous).toEqual([
      { loadKg: 60, reps: 5, isWarmup: true },
      { loadKg: 150, reps: 3, isWarmup: false },
      { loadKg: 140, reps: 5, isWarmup: false },
    ]);
    expect(history.bests).toEqual({ e1rmKg: 165, heaviestKg: 150 });
  });

  it("reads sets on idx_athlete_exercise: athlete, exercise, before the session, newest first", async () => {
    await fetchExerciseHistory("joey", "squat", "now", sessionStart);
    const sets = db.requests.filter((r) => r.tableId === "sets");
    expect(sets).toHaveLength(1);
    expect(sets[0].queries).toEqual([
      { method: "equal", attribute: "athlete_id", values: ["joey"] },
      { method: "equal", attribute: "exercise_id", values: ["squat"] },
      { method: "lessThan", attribute: "logged_at", values: [sessionStart.toISOString()] },
      { method: "orderDesc", attribute: "logged_at" },
      { method: "limit", values: [100] },
    ]);
    expect(db.requests.filter((r) => r.tableId === "stats_rollups")).toHaveLength(1);
  });

  it("is empty, not an error, for a lift never trained", async () => {
    expect(await fetchExerciseHistory("joey", "squat", "now", sessionStart)).toEqual({ previous: [], bests: null });
  });

  it("drops a set row the athlete did not stamp", async () => {
    db.tables.sets = [
      setRow("tue", "2026-10-20T18:00:00Z", { load_kg: 140 }),
      setRow("tue", "2026-10-20T18:05:00Z", { load_kg: 250, $permissions: setPermissions({ athleteId: "sam" }) }),
    ];
    const history = await fetchExerciseHistory("joey", "squat", "now", sessionStart);
    expect(history.previous.map((s) => s.loadKg)).toEqual([140]);
    expect(history.bests?.heaviestKg).toBe(140);
  });

  it("throws when either read fails, so the caller can try again later", async () => {
    db.fail = "sets";
    await expect(fetchExerciseHistory("joey", "squat", "now", sessionStart)).rejects.toThrow();
    db.fail = "stats_rollups";
    await expect(fetchExerciseHistory("joey", "squat", "now", sessionStart)).rejects.toThrow();
  });
});

describe("fetchSetsBefore", () => {
  it("stops after one page when that page reaches back past this week", async () => {
    db.tables.sets = Array.from({ length: 150 }, (_, i) =>
      setRow("old", new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()),
    );
    const sets = await fetchSetsBefore("joey", "squat", sessionStart);
    expect(sets).toHaveLength(100);
    expect(db.requests).toHaveLength(1);
  });

  it("pages on while every set is from earlier this week, so none is missed from the bests", async () => {
    // 120 sets on Monday and Tuesday, then older ones.
    db.tables.sets = [
      ...Array.from({ length: 120 }, (_, i) => setRow("mon", new Date(Date.UTC(2026, 9, 19, 12, i)).toISOString())),
      ...Array.from({ length: 30 }, (_, i) => setRow("old", new Date(Date.UTC(2026, 9, 5, 12, i)).toISOString())),
    ];
    const sets = await fetchSetsBefore("joey", "squat", sessionStart);
    expect(db.requests).toHaveLength(2);
    expect(sets).toHaveLength(150);
    expect(new Set(sets.map((s) => s.clientSetId)).size).toBe(150);
  });
});
