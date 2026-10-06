import { SERVER_ONLY_TABLES } from "@/appwrite/documents/policy";
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

  // Titled by what it asserts rather than by which phase happens to be done:
  // the old title named the phases and went stale twice in three tickets.
  it("holds every table the build has agreed on, and none it has not", () => {
    expect(schema.tables.map((t) => t.id).sort()).toEqual([
      "bodyweight_entries",
      "coach_athlete_links",
      "exercises",
      "invite_codes",
      "prescriptions",
      "profiles",
      "program_blocks",
      "program_days",
      "program_weeks",
      "programs",
      "reference_maxes",
      "sessions",
      "set_comments",
      "set_reviews",
      "sets",
      "stats_rollups",
    ]);
    // Templates are programs with no athlete, not a table of their own. A
    // second model for "the same block, unassigned" is the retrofit to avoid.
    expect(schema.tables.map((t) => t.id)).not.toContain("workout_templates");
  });

  /**
   * The drift this catches bit mid-ticket: reference_maxes was designed
   * client-writable, inverted to server-only when the probe proved a stranger
   * could forge a row, and the live table kept its create("users") until the
   * applier ran again. A build-time assertion is cheaper than finding it in a
   * probe against a live instance.
   */
  it("gives no table-level create to a server-only table", () => {
    for (const table of schema.tables.filter((t) => SERVER_ONLY_TABLES.includes(t.id as never))) {
      expect(table.permissions, `${table.id} must be written only with the API key`).toEqual([]);
    }
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

describe("the video bucket", () => {
  const bucket = schema.buckets.find((b) => b.id === "set_videos")!;

  it("exists, because infrastructure is not clicked into a console", () => {
    expect(bucket).toBeDefined();
    expect(schema.buckets).toHaveLength(1);
  });

  /**
   * Per-file, for the same reason tables use row security: the reader differs
   * per clip. A bucket-wide read would make every athlete's video visible to
   * every signed-in user on the instance.
   */
  it("secures each file rather than the bucket", () => {
    expect(bucket.fileSecurity).toBe(true);
    expect(bucket.permissions.join(" ")).not.toContain("read(");
  });

  /**
   * The instance's _APP_STORAGE_LIMIT is the hard ceiling -- Appwrite rejects
   * a bucket asking for more than the instance allows -- so this has to track
   * it rather than what we would like. Raised from Appwrite's 30MB default
   * when uploads moved to the NAS, because 30MB does not hold a 60-second
   * 1080p clip.
   */
  it("caps files at what the instance will actually accept", () => {
    expect(bucket.maximumFileSizeBytes).toBe(200_000_000);
  });

  it("accepts only what a phone camera produces", () => {
    expect([...bucket.allowedFileExtensions].sort()).toEqual(["m4v", "mov", "mp4", "webm"]);
  });

  /**
   * Appwrite skips encryption above 20MB, so enabling it would encrypt short
   * clips and silently not long ones. A guarantee that holds only sometimes is
   * worse than one that does not exist.
   */
  it("claims no encryption or antivirus it cannot actually deliver", () => {
    expect(bucket.encryption).toBe(false);
    expect(bucket.antivirus).toBe(false);
  });

  it("does not waste CPU compressing already-compressed video", () => {
    expect(bucket.compression).toBe("none");
  });
});

describe("the program tables (Order 19)", () => {
  const PROGRAM_TABLES = ["programs", "program_blocks", "program_weeks", "program_days", "prescriptions"];

  it("are written only with the API key", () => {
    // Appwrite polices who reads a row, not what a row claims: a client-side
    // create would let anyone put a day on anyone's Today.
    for (const id of PROGRAM_TABLES) expect(table(id).permissions, id).toEqual([]);
  });

  it("denormalise the program, coach and athlete onto every row", () => {
    for (const id of PROGRAM_TABLES.slice(1)) {
      expect(columnKeys(id), id).toEqual(expect.arrayContaining(["program_id", "coach_id", "athlete_id"]));
    }
  });

  it("let athlete_id be null, so a template is a program nobody is assigned to", () => {
    for (const id of PROGRAM_TABLES) {
      expect(table(id).columns.find((c) => c.key === "athlete_id")?.required, id).toBe(false);
    }
  });

  it("order every child by an explicit position", () => {
    for (const id of PROGRAM_TABLES.slice(1)) {
      expect(table(id).columns.find((c) => c.key === "position"), id).toMatchObject({ type: "integer", required: true });
    }
  });

  it("give each week its own status, so a week can be published on its own", () => {
    expect(table("program_weeks").columns.find((c) => c.key === "status")).toMatchObject({
      type: "enum",
      elements: ["draft", "published"],
    });
  });

  it("put the calendar on the day, and index Today's question", () => {
    expect(table("program_days").columns.find((c) => c.key === "scheduled_on")?.required).toBe(false);
    const index = table("program_days").indexes.find((i) => i.key === "idx_athlete_scheduled");
    expect(index?.columns).toEqual(["athlete_id", "scheduled_on"]);
  });

  it("keep the load cell as typed, with its kind derived beside it", () => {
    expect(columnKeys("prescriptions")).toEqual(expect.arrayContaining(["load", "load_kind"]));
  });

  it("add only optional columns to the tables athletes already write", () => {
    // Additive, and never required: a required column on sets would reject
    // every queued write from a phone still running last week's build.
    const added = [
      ["sessions", "program_day_id"],
      ["sets", "prescription_id"],
      ["sets", "prescribed"],
    ] as const;
    for (const [tableId, key] of added) {
      expect(table(tableId).columns.find((c) => c.key === key)?.required, `${tableId}.${key}`).toBe(false);
    }
  });
});
