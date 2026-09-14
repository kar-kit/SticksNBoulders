import { perm, type DatabaseSpec } from "./types";

export const DATABASE_ID = "sticksnboulders";

/**
 * The schema, as code.
 *
 * Two Appwrite constraints shape almost every decision here, both from
 * CLAUDE.md:
 *
 * 1. Access control is per row, stamped at write time. There is no policy to
 *    audit, only every write path -- so tables an athlete owns carry row
 *    security and no blanket table-level read.
 * 2. There is no GROUP BY. Aggregates cannot be computed on read, so e1rm_kg
 *    is stored on the set and stats_rollups exists at all.
 *
 * Scope is phase 0 and phase 1: the write helper needs coach_athlete_links,
 * and the athlete logger needs the rest. Programs, prescriptions and reference
 * maxes are deliberately absent -- the Program Editor's shape is still an open
 * question with Ruairi, and guessing it here is the one retrofit the build
 * plan calls expensive. They arrive as later migrations.
 */
export const schema: DatabaseSpec = {
  id: DATABASE_ID,
  name: "SticksNBoulders",
  version: 2,
  tables: [
    {
      id: "profiles",
      name: "Profiles",
      purpose:
        "One row per user. Sex is required for DOTS coefficients, which is why it blocks the bodyweight screen.",
      rowSecurity: true,
      permissions: [perm.createUsers],
      columns: [
        { key: "user_id", type: "string", size: 36, required: true },
        { key: "display_name", type: "string", size: 64, required: true },
        // Nullable: collected at onboarding, and an athlete may decline. DOTS
        // simply does not render until it is set.
        { key: "sex", type: "enum", elements: ["male", "female"], required: false },
        { key: "units", type: "enum", elements: ["kg", "lb"], required: false, default: "kg" },
        { key: "created_at", type: "datetime", required: true },
      ],
      indexes: [{ key: "idx_user_id", type: "unique", columns: ["user_id"] }],
    },

    {
      id: "exercises",
      name: "Exercises",
      purpose:
        "The typeahead library. Global rows are readable by everyone; a row created on the fly belongs to its author and their coach.",
      rowSecurity: true,
      permissions: [perm.createUsers],
      columns: [
        { key: "name", type: "string", size: 64, required: true },
        // Lowercased and stripped, so "Barbell Row" and "barbell row" collide
        // instead of creating a second library entry mid-session.
        { key: "normalised_name", type: "string", size: 64, required: true },
        { key: "is_global", type: "boolean", required: false, default: false },
        // Null on global rows. Present on anything typed in during a session.
        { key: "owner_id", type: "string", size: 36, required: false },
        { key: "created_at", type: "datetime", required: true },
      ],
      indexes: [
        { key: "idx_normalised", type: "key", columns: ["normalised_name"] },
        { key: "idx_owner", type: "key", columns: ["owner_id"] },
        // Fuzzy matching needs a text index, not a prefix scan.
        { key: "idx_name_search", type: "fulltext", columns: ["name"] },
      ],
    },

    {
      id: "sessions",
      name: "Sessions",
      purpose: "One training session. Totals are stored, not summed on read.",
      rowSecurity: true,
      permissions: [perm.createUsers],
      columns: [
        { key: "athlete_id", type: "string", size: 36, required: true },
        { key: "started_at", type: "datetime", required: true },
        // Null while the session is live. The logger uses this to resume.
        { key: "finished_at", type: "datetime", required: false },
        { key: "notes", type: "string", size: 1000, required: false },
        { key: "set_count", type: "integer", required: false, min: 0, default: 0 },
        { key: "tonnage_kg", type: "float", required: false, min: 0, default: 0 },
        { key: "client_session_id", type: "string", size: 64, required: true },
      ],
      indexes: [
        { key: "idx_athlete_started", type: "key", columns: ["athlete_id", "started_at"], orders: ["asc", "desc"] },
        // The offline queue retries. Without this, a retry writes a duplicate.
        { key: "idx_client_session_id", type: "unique", columns: ["client_session_id"] },
      ],
    },

    {
      id: "sets",
      name: "Sets",
      purpose:
        "The core record. Logged work is immutable in spirit: a coach editing a block never rewrites what an athlete already did.",
      rowSecurity: true,
      permissions: [perm.createUsers],
      columns: [
        { key: "session_id", type: "string", size: 36, required: true },
        // Denormalised from the session. Every coach-side query filters on it,
        // and Appwrite cannot join. Written by the same helper that stamps
        // permissions so the two cannot drift apart.
        { key: "athlete_id", type: "string", size: 36, required: true },
        { key: "exercise_id", type: "string", size: 36, required: true },
        { key: "set_index", type: "integer", required: true, min: 0 },
        { key: "load_kg", type: "float", required: true, min: 0 },
        { key: "reps", type: "integer", required: true, min: 0 },
        // Null is a real answer: the athlete tapped "Not sure". A forced guess
        // pollutes the personal RPE curve worse than a null does.
        { key: "rpe", type: "float", required: false, min: 6, max: 10 },
        { key: "is_warmup", type: "boolean", required: false, default: false },
        // Computed and stored at write time, never derived on read.
        { key: "e1rm_kg", type: "float", required: false, min: 0 },
        { key: "logged_at", type: "datetime", required: true },
        // Idempotency key from the offline queue. Unique-indexed below.
        { key: "client_set_id", type: "string", size: 64, required: true },
        { key: "video_file_id", type: "string", size: 64, required: false },
        { key: "notes", type: "string", size: 500, required: false },
      ],
      indexes: [
        { key: "idx_athlete_logged", type: "key", columns: ["athlete_id", "logged_at"], orders: ["asc", "desc"] },
        { key: "idx_session", type: "key", columns: ["session_id"] },
        {
          key: "idx_athlete_exercise",
          type: "key",
          columns: ["athlete_id", "exercise_id", "logged_at"],
          orders: ["asc", "asc", "desc"],
        },
        { key: "idx_client_set_id", type: "unique", columns: ["client_set_id"] },
      ],
    },

    {
      id: "stats_rollups",
      name: "Stats rollups",
      purpose:
        "One row per athlete per exercise per week. Every dashboard and chart reads this, never raw sets, because Appwrite has no GROUP BY. Written by a Function; no user may create one.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "athlete_id", type: "string", size: 36, required: true },
        { key: "exercise_id", type: "string", size: 36, required: true },
        // Monday, midnight UTC, of the week it covers.
        { key: "week_start", type: "datetime", required: true },
        { key: "set_count", type: "integer", required: true, min: 0 },
        { key: "volume_reps", type: "integer", required: true, min: 0 },
        { key: "tonnage_kg", type: "float", required: true, min: 0 },
        { key: "best_e1rm_kg", type: "float", required: false, min: 0 },
        // Heaviest single completed set that week. Warm-ups are excluded here,
        // the same rule the logger applies.
        { key: "best_single_kg", type: "float", required: false, min: 0 },
        { key: "best_single_reps", type: "integer", required: false, min: 0 },
        // The most reps done in one working set that week, and what it was
        // done with. Lift Detail shows it as a personal record, and "most
        // reps ever" is an aggregate -- so it is stored here rather than
        // scanned out of raw sets, like every other aggregate in the product.
        { key: "best_reps", type: "integer", required: false, min: 0 },
        { key: "best_reps_load_kg", type: "float", required: false, min: 0 },
        { key: "rebuilt_at", type: "datetime", required: true },
      ],
      indexes: [
        {
          key: "idx_athlete_exercise_week",
          type: "unique",
          columns: ["athlete_id", "exercise_id", "week_start"],
        },
        { key: "idx_athlete_week", type: "key", columns: ["athlete_id", "week_start"], orders: ["asc", "desc"] },
      ],
    },

    {
      id: "coach_athlete_links",
      name: "Coach-athlete links",
      purpose:
        "The source of truth for who can see whose data. The write helper reads this to stamp every permission, so a wrong row here is a privacy bug, not a display bug. Written only by a Function: redemption never runs client side.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "coach_id", type: "string", size: 36, required: true },
        { key: "athlete_id", type: "string", size: 36, required: true },
        // Revoked rather than deleted, so a coach losing access is auditable.
        // Required with no default: Appwrite forbids defaulting a required
        // column, and a link whose status was implied rather than written is
        // exactly the ambiguity a permissions table must not have.
        { key: "status", type: "enum", elements: ["active", "revoked"], required: true },
        { key: "linked_at", type: "datetime", required: true },
        { key: "revoked_at", type: "datetime", required: false },
      ],
      indexes: [
        { key: "idx_pair", type: "unique", columns: ["coach_id", "athlete_id"] },
        // Looked up on every write: "who coaches this athlete?"
        { key: "idx_athlete_status", type: "key", columns: ["athlete_id", "status"] },
        { key: "idx_coach_status", type: "key", columns: ["coach_id", "status"] },
      ],
    },
  ],
} as const;

export const TABLES = Object.fromEntries(schema.tables.map((t) => [t.id, t.id])) as Record<
  (typeof schema.tables)[number]["id"],
  string
>;
