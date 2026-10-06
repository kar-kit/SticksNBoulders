import { fetchMyProgram } from "./program-store";

/**
 * The draft rule at the read path. The fake Appwrite deliberately ignores
 * queries and returns draft rows anyway, so the second half proves the filter
 * holds even if the queries were wrong.
 */

interface Call {
  tableId: string;
  queries: string[];
}
const calls: Call[] = [];
const db = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]>, honourQueries: true }));

const parsed = (q: string) => JSON.parse(q) as { method: string; attribute?: string; values?: unknown[] };

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: {
      listRows: async ({ tableId, queries }: { tableId: string; queries: string[] }) => {
        calls.push({ tableId, queries });
        let rows = (db.rows[tableId] ?? []) as Array<Record<string, unknown>>;
        if (db.honourQueries) {
          for (const raw of queries) {
            const q = parsed(raw);
            if (q.method === "equal" && q.attribute) {
              rows = rows.filter((r) => q.values!.includes(r[q.attribute!]));
            }
          }
        }
        return { rows, total: rows.length };
      },
    },
  }),
}));

const prog = (over: Record<string, unknown> = {}) => ({
  $id: "p1",
  coach_id: "ruairi",
  athlete_id: "joey",
  name: "Block 1",
  status: "published",
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
  ...over,
});
const wk = (id: string, status: string) => ({
  $id: id,
  program_id: "p1",
  athlete_id: "joey",
  block_id: "b1",
  position: id === "w1" ? 0 : 1,
  status,
});
const dy = (id: string, week: string) => ({
  $id: id,
  program_id: "p1",
  athlete_id: "joey",
  block_id: "b1",
  week_id: week,
  position: 0,
  scheduled_on: "2026-10-01",
});
const ln = (id: string, day: string, week: string) => ({
  $id: id,
  program_id: "p1",
  athlete_id: "joey",
  week_id: week,
  day_id: day,
  exercise_id: "squat",
  position: 0,
  set_count: 3,
  updated_at: "",
});

beforeEach(() => {
  calls.length = 0;
  db.honourQueries = true;
  db.rows = {
    programs: [prog()],
    program_blocks: [{ $id: "b1", program_id: "p1", athlete_id: "joey", position: 0, name: "Volume" }],
    program_weeks: [wk("w1", "published"), wk("w2", "draft")],
    program_days: [dy("d1", "w1"), dy("d2", "w2")],
    prescriptions: [ln("l1", "d1", "w1"), ln("l2", "d2", "w2")],
  };
});

const ids = (tree: Awaited<ReturnType<typeof fetchMyProgram>>) =>
  tree?.blocks.flatMap((b) => b.weeks.flatMap((w) => [w.id, ...w.days.flatMap((d) => [d.id, ...d.prescriptions.map((p) => p.id)])]));

describe("fetchMyProgram", () => {
  it("returns published weeks only, and never asks for a draft week's days or lines", async () => {
    const tree = await fetchMyProgram("joey");
    expect(ids(tree)).toEqual(["w1", "d1", "l1"]);

    const asked = calls
      .filter((c) => c.tableId === "program_days" || c.tableId === "prescriptions")
      .flatMap((c) => c.queries.map(parsed))
      .filter((q) => q.attribute === "week_id");
    expect(asked).toHaveLength(2);
    for (const q of asked) expect(q.values).toEqual(["w1"]);
  });

  it("still filters when the queries are ignored", async () => {
    db.honourQueries = false;
    expect(ids(await fetchMyProgram("joey"))).toEqual(["w1", "d1", "l1"]);
  });

  it("is null for a draft program, an archived one, and one with only draft weeks", async () => {
    db.rows.programs = [prog({ status: "draft" })];
    expect(await fetchMyProgram("joey")).toBeNull();
    db.rows.programs = [prog({ status: "archived" })];
    expect(await fetchMyProgram("joey")).toBeNull();
    db.rows.programs = [prog()];
    db.rows.program_weeks = [wk("w1", "draft"), wk("w2", "draft")];
    expect(await fetchMyProgram("joey")).toBeNull();
    expect(calls.some((c) => c.tableId === "prescriptions")).toBe(false);
  });

  it("skips a published program with no live week for an older one that has one", async () => {
    db.rows.programs = [
      prog({ id: "x", $id: "x", updated_at: "2026-10-01T00:00:00.000Z" }),
      prog(),
    ];
    const tree = await fetchMyProgram("joey");
    expect(tree?.id).toBe("p1");
  });

  it("reads and never writes", async () => {
    await fetchMyProgram("joey");
    expect(calls.length).toBeGreaterThan(0);
  });
});
