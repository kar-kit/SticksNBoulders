import { DATABASE_ID, schema } from "./index";
import type { TableSpec } from "./types";

const table = (id: string): TableSpec => {
  const found = schema.tables.find((t) => t.id === id);
  if (!found) throw new Error(`No table ${id} in the schema`);
  return found;
};

const columnKeys = (id: string) => table(id).columns.map((c) => c.key);

describe("schema shape", () => {
  it("declares the database the rest of the app reads from", () => {
    expect(schema.id).toBe(DATABASE_ID);
    expect(schema.version).toBeGreaterThanOrEqual(1);
  });

  it("covers phases 0, 1 and the coach link, and nothing still an open question", () => {
    expect(schema.tables.map((t) => t.id).sort()).toEqual([
      "coach_athlete_links",
      "exercises",
      "invite_codes",
      "profiles",
      "sessions",
      "sets",
      "stats_rollups",
    ]);
    // Programs and prescriptions are absent on purpose: the Program Editor's
    // shape is unconfirmed with Ruairi and the build plan calls guessing it
    // the expensive retrofit.
    expect(schema.tables.map((t) => t.id)).not.toContain("programs");
    expect(schema.tables.map((t) => t.id)).not.toContain("prescriptions");
  });

  it("names every table uniquely, with unique columns and indexes inside each", () => {
    const ids = schema.tables.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of schema.tables) {
      const cols = t.columns.map((c) => c.key);
      expect(new Set(cols).size, `duplicate column in ${t.id}`).toBe(cols.length);
      const idx = t.indexes.map((i) => i.key);
      expect(new Set(idx).size, `duplicate index in ${t.id}`).toBe(idx.length);
    }
  });

  it("only indexes columns that exist", () => {
    for (const t of schema.tables) {
      const cols = new Set(t.columns.map((c) => c.key));
      for (const index of t.indexes) {
        for (const column of index.columns) {
          expect(cols.has(column), `${t.id}.${index.key} indexes missing column ${column}`).toBe(true);
        }
      }
    }
  });

  it("gives every index an order list matching its column count, or none at all", () => {
    for (const t of schema.tables) {
      for (const index of t.indexes) {
        if (!index.orders) continue;
        expect(index.orders.length, `${t.id}.${index.key}`).toBe(index.columns.length);
      }
    }
  });
});

describe("Appwrite constraints the server enforces", () => {
  it("never puts a default on a required column", () => {
    // Appwrite rejects this outright with column_default_unsupported. Caught
    // here rather than halfway through a live apply.
    for (const t of schema.tables) {
      for (const c of t.columns) {
        const hasDefault = "default" in c && c.default !== undefined;
        expect(c.required && hasDefault, `${t.id}.${c.key}`).toBe(false);
      }
    }
  });

  it("sizes every string column", () => {
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (c.type !== "string") continue;
        expect(c.size, `${t.id}.${c.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives every enum at least two elements", () => {
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (c.type !== "enum") continue;
        expect(c.elements.length, `${t.id}.${c.key}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("permission invariants", () => {
  it("puts row security on every table, because the reader differs per row", () => {
    for (const t of schema.tables) {
      expect(t.rowSecurity, t.id).toBe(true);
    }
  });

  it("never pairs row security with a blanket table-level read", () => {
    // Appwrite grants access on table-level OR row-level permission. A
    // table-level read alongside row security makes every row readable by
    // every signed-in user, silently. This is the sev-1 shape.
    for (const t of schema.tables) {
      const reads = t.permissions.filter((p) => p.startsWith("read("));
      expect(reads, `${t.id} would expose every row`).toEqual([]);
    }
  });

  it("lets no user create a rollup, a coach link or an invite code", () => {
    // Rollups are written by a Function. Link redemption runs server side,
    // never client side, or an athlete could grant themselves a coach -- and a
    // code someone can mint is a code they can mint naming another coach.
    expect(table("stats_rollups").permissions).toEqual([]);
    expect(table("coach_athlete_links").permissions).toEqual([]);
    expect(table("invite_codes").permissions).toEqual([]);
  });

  it("lets a signed-in user create their own logging rows", () => {
    for (const id of ["profiles", "exercises", "sessions", "sets"]) {
      expect(table(id).permissions, id).toContain('create("users")');
    }
  });
});

describe("invite codes", () => {
  it("holds no code column, because the code is the row id", () => {
    // Uniqueness then comes from the primary key rather than from an index
    // anyone has to trust, and redeeming one is a point read, not a query.
    expect(columnKeys("invite_codes")).toEqual(["coach_id", "created_at"]);
  });

  it("allows a coach only one code, so the one they gave out stays the one", () => {
    const index = table("invite_codes").indexes.find((i) => i.columns.includes("coach_id"));
    expect(index?.type).toBe("unique");
  });
});

describe("the two Appwrite rules from CLAUDE.md", () => {
  it("denormalises athlete_id onto sets, because there is no join", () => {
    expect(columnKeys("sets")).toContain("athlete_id");
    expect(columnKeys("sets")).toContain("session_id");
  });

  it("stores e1rm on the set rather than deriving it on read", () => {
    expect(columnKeys("sets")).toContain("e1rm_kg");
  });

  it("indexes every field the coach side filters or sorts by", () => {
    const setIndexes = table("sets").indexes.map((i) => i.columns.join(","));
    expect(setIndexes).toContain("athlete_id,logged_at");
    expect(setIndexes).toContain("athlete_id,exercise_id,logged_at");
    expect(setIndexes).toContain("session_id");
  });

  it("keys rollups one per athlete per exercise per week, uniquely", () => {
    const unique = table("stats_rollups").indexes.find((i) => i.type === "unique");
    expect(unique?.columns).toEqual(["athlete_id", "exercise_id", "week_start"]);
  });

  it("holds the aggregates every chart reads", () => {
    const keys = columnKeys("stats_rollups");
    for (const key of ["set_count", "volume_reps", "tonnage_kg", "best_e1rm_kg"]) {
      expect(keys, key).toContain(key);
    }
  });
});

describe("offline safety", () => {
  it.each([
    ["sets", "client_set_id"],
    ["sessions", "client_session_id"],
  ])("unique-indexes %s.%s so a retry cannot duplicate a row", (tableId, key) => {
    // The write-ahead queue retries on reconnect. Without a unique index, a
    // retried set is logged twice and the athlete's tonnage is wrong.
    expect(columnKeys(tableId)).toContain(key);
    const index = table(tableId).indexes.find((i) => i.columns.join(",") === key);
    expect(index?.type).toBe("unique");
  });

  it.each([
    ["sets", "client_set_id"],
    ["sessions", "client_session_id"],
  ])("requires %s.%s, so a row cannot be written without one", (tableId, key) => {
    const column = table(tableId).columns.find((c) => c.key === key);
    expect(column?.required).toBe(true);
  });
});

describe("logging rules encoded in the schema", () => {
  it("allows a null RPE, because 'not sure' is a real answer", () => {
    const rpe = table("sets").columns.find((c) => c.key === "rpe");
    expect(rpe?.required).toBe(false);
    expect(rpe).toMatchObject({ type: "float", min: 6, max: 10 });
  });

  it("carries the warm-up flag that excludes a set from PRs", () => {
    expect(columnKeys("sets")).toContain("is_warmup");
  });

  it("lets a session stay open, so the logger can resume one", () => {
    const finished = table("sessions").columns.find((c) => c.key === "finished_at");
    expect(finished?.required).toBe(false);
  });

  it("lets sex be unset, but keeps it for DOTS", () => {
    const sex = table("profiles").columns.find((c) => c.key === "sex");
    expect(sex?.required).toBe(false);
    expect(sex).toMatchObject({ type: "enum", elements: ["male", "female"] });
  });

  it("gives exercises a fulltext index, because the rule is type, never hunt", () => {
    const search = table("exercises").indexes.find((i) => i.type === "fulltext");
    expect(search?.columns).toEqual(["name"]);
    expect(columnKeys("exercises")).toContain("normalised_name");
  });
});
