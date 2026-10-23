import { isExecutable, planSchema, type CurrentState } from "./plan";
import type { DatabaseSpec } from "./types";

const tiny: DatabaseSpec = {
  id: "db",
  name: "DB",
  version: 1,
  buckets: [],
  tables: [
    {
      id: "sets",
      name: "Sets",
      purpose: "test",
      rowSecurity: true,
      permissions: ['create("users")'],
      columns: [
        { key: "athlete_id", type: "string", size: 36, required: true },
        { key: "rpe", type: "float", required: false, min: 6, max: 10 },
      ],
      indexes: [
        { key: "idx_athlete", type: "key", columns: ["athlete_id"] },
        { key: "idx_sorted", type: "key", columns: ["athlete_id", "rpe"], orders: ["asc", "desc"] },
      ],
    },
  ],
};

/** The state Appwrite reports once `tiny` has been applied. */
const matching: CurrentState = {
  databaseExists: true,
  buckets: [],
  tables: [
    {
      id: "sets",
      permissions: ['create("users")'],
      rowSecurity: true,
      columns: [
        { key: "athlete_id", type: "string", required: true, size: 36 },
        { key: "rpe", type: "double", required: false },
      ],
      indexes: [
        // Appwrite reports an empty orders array for a single-column index.
        { key: "idx_athlete", type: "key", columns: ["athlete_id"], orders: [] },
        { key: "idx_sorted", type: "key", columns: ["athlete_id", "rpe"], orders: ["asc", "desc"] },
      ],
    },
  ],
};

describe("planSchema on an empty server", () => {
  const plan = planSchema({ databaseExists: false, tables: [], buckets: [] }, tiny);

  it("creates the database first", () => {
    expect(plan[0]).toMatchObject({ kind: "create-database", databaseId: "db" });
  });

  it("creates every table, column and index", () => {
    expect(plan.filter((a) => a.kind === "create-table")).toHaveLength(1);
    expect(plan.filter((a) => a.kind === "create-column")).toHaveLength(2);
    expect(plan.filter((a) => a.kind === "create-index")).toHaveLength(2);
  });

  it("orders a table's columns before its indexes", () => {
    const lastColumn = plan.findLastIndex((a) => a.kind === "create-column");
    const firstIndex = plan.findIndex((a) => a.kind === "create-index");
    expect(lastColumn).toBeLessThan(firstIndex);
  });
});

describe("planSchema when the server already matches", () => {
  it("plans nothing at all", () => {
    expect(planSchema(matching, tiny)).toEqual([]);
  });

  it("does not rebuild a single-column index that reports empty orders", () => {
    // This exact case made the first implementation rebuild half the indexes
    // on every run, which defeats the point of an idempotent script.
    const plan = planSchema(matching, tiny);
    expect(plan.filter((a) => a.kind === "recreate-index")).toEqual([]);
  });

  it("maps a float column to Appwrite's 'double' without reporting drift", () => {
    expect(planSchema(matching, tiny)).toEqual([]);
  });
});

describe("planSchema drift detection", () => {
  function withTable(mutate: (t: CurrentState["tables"][number]) => void): CurrentState {
    const next = structuredClone(matching);
    mutate(next.tables[0]);
    return next;
  }

  it("adds a column that is missing", () => {
    const plan = planSchema(
      withTable((t) => {
        t.columns = t.columns.filter((c) => c.key !== "rpe");
      }),
      tiny,
    );
    expect(plan).toEqual([{ kind: "create-column", tableId: "sets", column: tiny.tables[0].columns[1] }]);
  });

  it("updates a table whose permissions drifted", () => {
    const plan = planSchema(
      withTable((t) => {
        t.permissions = ['create("users")', 'read("users")'];
      }),
      tiny,
    );
    expect(plan[0]).toMatchObject({ kind: "update-table" });
    expect((plan[0] as { reason: string }).reason).toContain("read");
  });

  it("updates a table whose row security was turned off", () => {
    const plan = planSchema(
      withTable((t) => {
        t.rowSecurity = false;
      }),
      tiny,
    );
    expect(plan[0]).toMatchObject({ kind: "update-table" });
  });

  it("rebuilds an index whose columns changed", () => {
    const plan = planSchema(
      withTable((t) => {
        t.indexes[1].columns = ["rpe"];
      }),
      tiny,
    );
    expect(plan[0]).toMatchObject({ kind: "recreate-index" });
  });

  it("rebuilds an index whose declared orders changed", () => {
    const plan = planSchema(
      withTable((t) => {
        t.indexes[1].orders = ["asc", "asc"];
      }),
      tiny,
    );
    expect(plan[0]).toMatchObject({ kind: "recreate-index" });
  });
});

describe("planSchema and a numeric column's bounds", () => {
  const withRpeBounds = (min: number | undefined, max: number | undefined) => {
    const current = structuredClone(matching);
    Object.assign(current.tables[0].columns[1], { min, max });
    return current;
  };
  const lowered: DatabaseSpec = structuredClone(tiny);
  (lowered.tables[0].columns[1] as { min?: number }).min = 3;

  it("plans nothing when the bounds the schema declares match", () => {
    expect(planSchema(withRpeBounds(6, 10), tiny)).toEqual([]);
  });

  it("ignores a bound the server does not report", () => {
    expect(planSchema(withRpeBounds(undefined, undefined), lowered)).toEqual([]);
  });

  it("ignores a bound the schema does not declare, which Appwrite reports as the type's extreme", () => {
    const open: DatabaseSpec = structuredClone(tiny);
    delete (open.tables[0].columns[1] as { max?: number }).max;
    expect(planSchema(withRpeBounds(6, Number.MAX_VALUE), open)).toEqual([]);
  });

  it("widens a lowered floor in place: v15's RPE 6 to v16's 3", () => {
    const plan = planSchema(withRpeBounds(6, 10), lowered);
    expect(plan).toEqual([
      {
        kind: "update-column",
        tableId: "sets",
        column: { key: "rpe", type: "float", required: false, min: 3, max: 10 },
        reason: "min is 6, schema says 3",
      },
    ]);
    expect(plan.every(isExecutable)).toBe(true);
  });

  it("widens a raised ceiling in place too", () => {
    const plan = planSchema(withRpeBounds(6, 9), tiny);
    expect(plan).toMatchObject([{ kind: "update-column", reason: "max is 9, schema says 10" }]);
  });

  it("reports a narrowing for a human, because rows may sit outside the new range", () => {
    const plan = planSchema(withRpeBounds(3, 10), tiny);
    expect(plan).toMatchObject([{ kind: "manual-column-change", tableId: "sets" }]);
    expect(plan.some(isExecutable)).toBe(false);
  });

  it("reports one that widens one end and narrows the other, rather than half-applying it", () => {
    const plan = planSchema(withRpeBounds(8, 12), lowered);
    expect(plan).toMatchObject([{ kind: "manual-column-change", reason: expect.stringContaining("narrowing") }]);
  });

  it("leaves a type mismatch to a human without also planning a bounds update", () => {
    const current = withRpeBounds(6, 10);
    current.tables[0].columns[1].type = "integer";
    expect(planSchema(current, lowered).map((a) => a.kind)).toEqual(["manual-column-change"]);
  });
});

describe("planSchema refuses to destroy data", () => {
  it("reports a narrowed string column instead of altering it", () => {
    // Shrinking a column truncates. That is an athlete's logged work, so a
    // human decides, not a script run at 2am before a phase ships.
    const current = structuredClone(matching);
    current.tables[0].columns[0].size = 12;
    const plan = planSchema(current, tiny);
    expect(plan[0]).toMatchObject({ kind: "manual-column-change", tableId: "sets" });
    expect(plan.every((a) => !isExecutable(a))).toBe(true);
  });

  it("reports a type change instead of applying it", () => {
    const current = structuredClone(matching);
    current.tables[0].columns[1].type = "string";
    expect(planSchema(current, tiny)[0]).toMatchObject({ kind: "manual-column-change" });
  });

  it("reports a required flag that drifted", () => {
    const current = structuredClone(matching);
    current.tables[0].columns[1].required = true;
    expect(planSchema(current, tiny)[0]).toMatchObject({ kind: "manual-column-change" });
  });

  it("reports orphans but never deletes them", () => {
    const current = structuredClone(matching);
    current.tables.push({
      id: "leaderboards",
      permissions: [],
      rowSecurity: false,
      columns: [],
      indexes: [],
    });
    current.tables[0].columns.push({ key: "scale_photo_id", type: "string", required: false, size: 64 });
    current.tables[0].indexes.push({ key: "idx_dead", type: "key", columns: ["athlete_id"], orders: [] });

    const plan = planSchema(current, tiny);
    expect(plan.map((a) => a.kind).sort()).toEqual(["orphan-column", "orphan-index", "orphan-table"]);
    expect(plan.some(isExecutable)).toBe(false);
  });
});
