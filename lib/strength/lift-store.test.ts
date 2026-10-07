import { setPermissions } from "@/appwrite/documents/policy";
import { fetchLiftWeeks, fetchRecentSetsFor } from "./lift-store";

type Row = { $id: string } & Record<string, unknown>;

interface ParsedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

/**
 * An in-memory Appwrite that applies the queries the store sends: equal,
 * orderAsc/orderDesc on any column, cursorAfter and limit. Provenance is NOT
 * mocked here -- the recent-sets list is meant to drop forged rows, and that is
 * part of what is under test.
 */
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: {
      listRows: async ({ tableId, queries = [] }: { tableId: string; queries?: string[] }) => {
        const parsed = queries.map((q) => JSON.parse(q) as ParsedQuery);
        let rows = [...(db.tables[tableId] ?? [])];
        for (const q of parsed) {
          if (q.method === "equal") rows = rows.filter((r) => q.values!.includes(r[q.attribute!]));
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

const pad = (i: number) => String(i).padStart(4, "0");

beforeEach(() => {
  db.tables = {};
});

describe("fetchLiftWeeks", () => {
  const rollup = (id: string, over: Record<string, unknown> = {}): Row => ({
    $id: id,
    athlete_id: "joey",
    exercise_id: "squat",
    week_start: "2026-09-07T00:00:00.000Z",
    best_e1rm_kg: 150,
    best_single_kg: 140,
    best_single_reps: 3,
    best_reps: 8,
    best_reps_load_kg: 120,
    ...over,
  });

  it("reads every week of this athlete's lift, past the first page", async () => {
    db.tables.stats_rollups = [
      ...Array.from({ length: 130 }, (_, i) => rollup(`w-${pad(i)}`)),
      rollup("bench", { exercise_id: "bench" }),
      rollup("sam", { athlete_id: "sam" }),
    ];
    const weeks = await fetchLiftWeeks("joey", "squat");
    expect(weeks).toHaveLength(130);
  });

  it("skips a week it cannot place rather than plotting it somewhere", async () => {
    db.tables.stats_rollups = [rollup("a"), rollup("b", { week_start: "not a date" })];
    expect(await fetchLiftWeeks("joey", "squat")).toHaveLength(1);
  });
});

describe("fetchRecentSetsFor", () => {
  const setRow = (i: number, over: Record<string, unknown> = {}): Row => ({
    $id: `s-${pad(i)}`,
    $permissions: setPermissions({ athleteId: "joey" }),
    athlete_id: "joey",
    exercise_id: "squat",
    client_set_id: `c-${pad(i)}`,
    load_kg: 100,
    reps: 5,
    rpe: 8,
    is_warmup: false,
    logged_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    ...over,
  });

  it("lists the newest working sets first, at most forty", async () => {
    db.tables.sets = Array.from({ length: 50 }, (_, i) => setRow(i));
    const sets = await fetchRecentSetsFor("joey", "squat");
    expect(sets).toHaveLength(40);
    expect(sets[0].clientSetId).toBe("c-0049");
    expect(sets.at(-1)?.clientSetId).toBe("c-0010");
  });

  it("leaves out warm-ups, other lifts and other athletes", async () => {
    db.tables.sets = [
      setRow(1),
      setRow(2, { is_warmup: true }),
      setRow(3, { exercise_id: "bench" }),
      setRow(4, { athlete_id: "sam", $permissions: setPermissions({ athleteId: "sam" }) }),
    ];
    expect((await fetchRecentSetsFor("joey", "squat")).map((s) => s.clientSetId)).toEqual(["c-0001"]);
  });

  /** A stranger can write a row that names Joey; it must not appear as his set. */
  it("drops a row not stamped by the athlete it names", async () => {
    db.tables.sets = [setRow(1), setRow(2, { $permissions: setPermissions({ athleteId: "sam" }) })];
    expect((await fetchRecentSetsFor("joey", "squat")).map((s) => s.clientSetId)).toEqual(["c-0001"]);
  });
});
