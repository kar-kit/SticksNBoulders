import { currentMax } from "./reference-max";
import { fetchEstimatedMaxes, fetchReferenceMaxes, setReferenceMax } from "./reference-max-store";

type Row = { $id: string } & Record<string, unknown>;

interface ParsedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

/**
 * An in-memory Appwrite that applies the queries the store sends -- equal,
 * orderAsc/orderDesc on $id, cursorAfter and limit -- so a wrong query gives a
 * wrong answer here rather than being ignored.
 */
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    account: { createJWT: async () => ({ jwt: "jwt" }) },
    tables: {
      listRows: async ({ tableId, queries = [] }: { tableId: string; queries?: string[] }) => {
        const parsed = queries.map((q) => JSON.parse(q) as ParsedQuery);
        let rows = [...(db.tables[tableId] ?? [])].sort((a, b) => a.$id.localeCompare(b.$id));
        for (const q of parsed) {
          if (q.method === "equal") rows = rows.filter((r) => q.values!.includes(r[q.attribute!]));
          if (q.method === "orderDesc" && q.attribute === "$id") rows.reverse();
        }
        const cursor = parsed.find((q) => q.method === "cursorAfter")?.values?.[0];
        if (cursor) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
        const limit = Number(parsed.find((q) => q.method === "limit")?.values?.[0] ?? 25);
        return { rows: rows.slice(0, limit) };
      },
    },
  }),
}));

const maxRow = (id: string, over: Record<string, unknown> = {}): Row => ({
  $id: id,
  athlete_id: "joey",
  exercise_id: "squat",
  kind: "training",
  value_kg: 180,
  effective_from: "2026-08-12T00:00:00.000Z",
  recorded_by: "ruairi",
  ...over,
});

const pad = (i: number) => String(i).padStart(5, "0");

beforeEach(() => {
  db.tables = {};
});

describe("fetchReferenceMaxes", () => {
  /**
   * The cap keeps the newest rows. Read ascending, 250 entries would freeze the
   * panel on the 200 oldest and every percentage would price off a stale max.
   */
  it("keeps the newest entries when there are more than the cap", async () => {
    db.tables.reference_maxes = Array.from({ length: 250 }, (_, i) => maxRow(`r-${pad(i)}`, { value_kg: 100 + i }));
    const entries = await fetchReferenceMaxes("joey");
    expect(entries).toHaveLength(200);
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("r-00249");
    expect(ids).not.toContain("r-00000");
  });

  it("reads only this athlete's rows", async () => {
    db.tables.reference_maxes = [maxRow("a"), maxRow("b", { athlete_id: "sam", value_kg: 999 })];
    expect((await fetchReferenceMaxes("joey")).map((e) => e.id)).toEqual(["a"]);
  });

  it("skips a row with no number or an unknown kind rather than guessing", async () => {
    db.tables.reference_maxes = [
      maxRow("ok"),
      maxRow("no-value", { value_kg: null }),
      maxRow("estimated", { kind: "estimated" }),
    ];
    expect((await fetchReferenceMaxes("joey")).map((e) => e.id)).toEqual(["ok"]);
  });

  /**
   * The store and the resolver together, as every screen uses them: a coach
   * enters 1800 by mistake, then 180 for the same day. The fix must win
   * whichever direction the store reads in.
   */
  it("hands currentMax entries that resolve a same-day typo to its correction", async () => {
    db.tables.reference_maxes = [
      maxRow("68c3a1f00012a3b4c5d", { value_kg: 1800 }),
      maxRow("68c3a1f3001f0a9b8c7", { value_kg: 180 }),
    ];
    const entries = await fetchReferenceMaxes("joey");
    expect(currentMax(entries, "training", new Date("2026-09-15T10:00:00.000Z"))?.valueKg).toBe(180);
  });
});

describe("fetchEstimatedMaxes", () => {
  const rollup = (id: string, over: Record<string, unknown> = {}): Row => ({
    $id: id,
    athlete_id: "joey",
    exercise_id: "squat",
    week_start: "2026-09-07T00:00:00.000Z",
    best_e1rm_kg: 150,
    ...over,
  });

  /** A deload week does not lower an estimated max: the best, not the latest. */
  it("takes the best week across every page, with that week's date", async () => {
    db.tables.stats_rollups = Array.from({ length: 150 }, (_, i) =>
      rollup(`w-${pad(i)}`, { best_e1rm_kg: 150, week_start: `week-${i}` }),
    );
    // Past the first page of 100, and followed by a lighter, later week.
    db.tables.stats_rollups[120].best_e1rm_kg = 191.5;
    db.tables.stats_rollups[149].best_e1rm_kg = 140;
    db.tables.stats_rollups.push(rollup("bench", { exercise_id: "bench", best_e1rm_kg: 120 }));
    db.tables.stats_rollups.push(rollup("other", { athlete_id: "sam", best_e1rm_kg: 400 }));

    const best = await fetchEstimatedMaxes("joey");
    expect(best.get("squat")).toEqual({ valueKg: 191.5, asOf: "week-120" });
    expect(best.get("bench")?.valueKg).toBe(120);
    expect(best.size).toBe(2);
  });

  it("has no estimate from weeks that produced none", async () => {
    db.tables.stats_rollups = [rollup("a", { best_e1rm_kg: null }), rollup("b", { best_e1rm_kg: 0 })];
    expect((await fetchEstimatedMaxes("joey")).size).toBe(0);
  });
});

describe("setReferenceMax", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("surfaces the server's reason, which is worth more than a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ reason: "A max over 600kg is a typo" }), { status: 400 })),
    );
    await expect(
      setReferenceMax({ athleteId: "joey", exerciseId: "squat", kind: "training", valueKg: 1800 }),
    ).rejects.toThrow("A max over 600kg is a typo");
  });
});
