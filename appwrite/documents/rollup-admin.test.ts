import { describe, expect, it } from "vitest";
import { setPermissions } from "./policy";
import { rebuildRollup, type RollupTables } from "./rollup-admin";

/**
 * The rollup after a set is deleted.
 *
 * Every chart, PR and estimated max reads stats_rollups, never raw sets, so a
 * delete that leaves the rollup alone leaves a week claiming work that did not
 * happen -- and it looks exactly like a correct week. These drive the same
 * rebuildRollup the live route calls, against an in-memory pair of tables that
 * honour the one query shape it uses.
 */

const ATHLETE = "athlete_joey";
const SQUAT = "squat";
const DB = "sticksnboulders";
// Wednesday 16 Sep 2026, inside the week beginning Monday 14 Sep.
const WEDNESDAY = new Date("2026-09-16T18:00:00.000Z");
const NOW = new Date("2026-09-16T19:00:00.000Z");

type Row = Record<string, unknown> & { $id: string };

function tables(initialSets: Row[], initialRollups: Row[] = []) {
  const db: Record<string, Row[]> = { sets: [...initialSets], stats_rollups: [...initialRollups] };
  let counter = 0;

  /** Enough of Appwrite's query language to answer the two reads rebuildRollup makes. */
  const matches = (row: Row, queries: string[]) =>
    queries.every((raw) => {
      const q = JSON.parse(raw) as { method: string; attribute?: string; values?: unknown[] };
      const value = q.attribute ? row[q.attribute] : undefined;
      switch (q.method) {
        case "equal":
          return (q.values ?? []).includes(value);
        case "greaterThanEqual":
          return String(value) >= String(q.values?.[0]);
        case "lessThan":
          return String(value) < String(q.values?.[0]);
        default:
          return true;
      }
    });

  const store: RollupTables = {
    async listRows({ tableId, queries }) {
      return { rows: db[tableId].filter((row) => matches(row, queries)) };
    },
    async deleteRow({ tableId, rowId }) {
      db[tableId] = db[tableId].filter((row) => row.$id !== rowId);
      return {};
    },
    writer: {
      async createRow({ tableId, rowId, data }) {
        const row = { $id: rowId ?? `r${++counter}`, ...(data as object) };
        db[tableId].push(row);
        return row;
      },
      async updateRow({ tableId, rowId, data }) {
        db[tableId] = db[tableId].map((row) =>
          row.$id === rowId
            ? // Appwrite semantics: an undefined field is left as it was.
              Object.fromEntries(
                Object.entries({ ...row, ...(data as object) }).map(([k, v]) => [k, v === undefined ? row[k] : v]),
              ) as Row
            : row,
        );
        return { $id: rowId };
      },
      async deleteRow({ tableId, rowId }) {
        db[tableId] = db[tableId].filter((row) => row.$id !== rowId);
        return {};
      },
    },
  };

  const deleteSet = (id: string) => {
    db.sets = db.sets.filter((row) => row.$id !== id);
  };
  return { store, db, deleteSet };
}

const set = (id: string, loadKg: number, reps: number, extra: Partial<Row> = {}): Row => ({
  $id: id,
  // Stamped as the write helper would, because the rebuild only counts sets
  // their athlete wrote.
  $permissions: setPermissions({ athleteId: ATHLETE }),
  athlete_id: ATHLETE,
  exercise_id: SQUAT,
  load_kg: loadKg,
  reps,
  is_warmup: false,
  e1rm_kg: null,
  logged_at: WEDNESDAY.toISOString(),
  ...extra,
});

const rebuild = (store: RollupTables) =>
  rebuildRollup(store, DB, { athleteId: ATHLETE, exerciseId: SQUAT, loggedAt: WEDNESDAY }, () => NOW);

describe("rebuilding a week after a set is deleted", () => {
  it("drops the deleted set from volume, tonnage and set count", async () => {
    const t = tables([set("a", 140, 5), set("b", 140, 5), set("c", 140, 5)]);
    await rebuild(t.store);
    expect(t.db.stats_rollups[0]).toMatchObject({ set_count: 3, volume_reps: 15, tonnage_kg: 2100 });

    t.deleteSet("b");
    const result = await rebuild(t.store);

    expect(result.status).toBe("written");
    expect(t.db.stats_rollups).toHaveLength(1);
    expect(t.db.stats_rollups[0]).toMatchObject({ set_count: 2, volume_reps: 10, tonnage_kg: 1400 });
  });

  it("gives back the PR a mistyped set was claiming", async () => {
    // The case the feature exists for: 1500 typed for 150. Until the set goes,
    // it is the athlete's best single and best e1RM for the week.
    const t = tables([
      set("real", 150, 3, { e1rm_kg: 165 }),
      set("typo", 1500, 3, { e1rm_kg: 1650 }),
    ]);
    await rebuild(t.store);
    expect(t.db.stats_rollups[0]).toMatchObject({ best_single_kg: 1500, best_e1rm_kg: 1650 });

    t.deleteSet("typo");
    await rebuild(t.store);

    expect(t.db.stats_rollups[0]).toMatchObject({
      best_single_kg: 150,
      best_single_reps: 3,
      best_e1rm_kg: 165,
      best_reps: 3,
      best_reps_load_kg: 150,
    });
  });

  it("clears the best e1RM when the only set that had one is deleted", async () => {
    // An update ignores undefined, so a rollup written with "no estimate" as
    // undefined kept the deleted set's number forever -- and the rebuild script
    // could not fix it either, because it writes through the same helper.
    const t = tables([set("rpe", 150, 3, { e1rm_kg: 165 }), set("no-rpe", 140, 5)]);
    await rebuild(t.store);
    expect(t.db.stats_rollups[0].best_e1rm_kg).toBe(165);

    t.deleteSet("rpe");
    await rebuild(t.store);

    expect(t.db.stats_rollups[0].best_e1rm_kg).toBeNull();
    expect(t.db.stats_rollups[0]).toMatchObject({ set_count: 1, best_single_kg: 140 });
  });

  it("removes the week's row when its last working set is deleted", async () => {
    // No row, not a row of zeroes: zeroes say the week happened and was empty.
    const t = tables([set("only", 140, 5)]);
    await rebuild(t.store);
    expect(t.db.stats_rollups).toHaveLength(1);

    t.deleteSet("only");
    const result = await rebuild(t.store);

    expect(result.status).toBe("removed");
    expect(t.db.stats_rollups).toHaveLength(0);
  });

  it("removes it too when only warm-ups are left", async () => {
    const t = tables([set("warm", 60, 5, { is_warmup: true }), set("work", 140, 5)]);
    await rebuild(t.store);
    t.deleteSet("work");
    expect((await rebuild(t.store)).status).toBe("removed");
    expect(t.db.stats_rollups).toHaveLength(0);
  });

  it("is safe to run again, which is what a retried queue does", async () => {
    const t = tables([set("a", 140, 5), set("b", 150, 5)]);
    await rebuild(t.store);
    t.deleteSet("b");
    await rebuild(t.store);
    const once = { ...t.db.stats_rollups[0] };
    await rebuild(t.store);
    expect(t.db.stats_rollups).toHaveLength(1);
    expect(t.db.stats_rollups[0]).toEqual(once);
  });

  it("leaves other weeks alone", async () => {
    const lastWeek = new Date("2026-09-09T18:00:00.000Z").toISOString();
    const t = tables([set("this", 140, 5), set("last", 200, 1, { logged_at: lastWeek })]);
    await rebuild(t.store);
    t.deleteSet("this");
    await rebuild(t.store);
    // This week's row is gone; last week's set was never counted here.
    expect(t.db.stats_rollups).toHaveLength(0);
    expect(t.db.sets.map((s) => s.$id)).toEqual(["last"]);
  });
});

describe("rebuilding a week that holds a forged set", () => {
  // The rebuild reads with the API key, so it sees every row carrying this
  // athlete's id -- including one a stranger created and stamped for everyone.
  const STRANGER = "athlete_stranger";
  const forged = set("forged", 400, 1, {
    e1rm_kg: 400,
    $permissions: ['read("users")', `update("user:${STRANGER}")`, `delete("user:${STRANGER}")`],
  });

  it("counts the athlete's own set and ignores the stranger's", async () => {
    const t = tables([set("real", 150, 3, { e1rm_kg: 165 }), forged]);
    await rebuild(t.store);
    expect(t.db.stats_rollups[0]).toMatchObject({
      set_count: 1,
      volume_reps: 3,
      best_single_kg: 150,
      best_e1rm_kg: 165,
    });
  });

  it("writes no week from forged sets alone", async () => {
    const t = tables([forged]);
    expect((await rebuild(t.store)).status).toBe("absent");
    expect(t.db.stats_rollups).toHaveLength(0);
  });
});
