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
 * Scope is phase 0, phase 1, the coach link, reference maxes, and the program
 * data layer: the write helper needs coach_athlete_links, the athlete logger
 * needs the rest, invite_codes is how a coach reaches an athlete in the first
 * place, reference_maxes is what a percentage is a percentage of, and the five
 * program tables are what a prescription hangs off.
 *
 * The program tables (Order 19) are deliberately the shape that survives any
 * answer to Ruairi's open question -- block up front, week by week, or session
 * by session -- and whether he reuses templates. See docs/programs.md. The
 * editor screen that writes them is still blocked on that answer; the tables
 * are not.
 */
export const schema: DatabaseSpec = {
  id: DATABASE_ID,
  name: "SticksNBoulders",
  version: 9,
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
        // The prescribed day this session was started from, or null for free
        // logging, which stays first-class. A pointer, never a copy: the
        // session is the athlete's record, and nothing on the program side
        // writes back to it.
        { key: "program_day_id", type: "string", size: 36, required: false },
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
        // The prescription line this set was logged against, or null for a set
        // nobody prescribed. A pointer for "which line was this", not a
        // dependency: the coach may edit or delete the line afterwards.
        { key: "prescription_id", type: "string", size: 36, required: false },
        // What the target said at the moment the set was logged, e.g.
        // "5 x 152.5 kg (75%)". A snapshot on purpose -- constraint 5: a coach
        // editing the block later must never rewrite what this set was an
        // answer to, and a pointer alone would silently start pointing at the
        // new plan.
        { key: "prescribed", type: "string", size: 160, required: false },
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
      id: "set_reviews",
      name: "Set reviews",
      purpose:
        "One row per coach per clip they have cleared. The Review Queue is sets-with-video MINUS these, so a queue emptied on Sunday is still empty on Monday. Per coach on purpose: Ruairi and Louis both coach at Uxbridge, and one clearing a clip must not clear it for the other.",
      rowSecurity: true,
      permissions: [perm.createUsers],
      columns: [
        { key: "coach_id", type: "string", size: 36, required: true },
        // Denormalised from the set, like athlete_id everywhere else: Appwrite
        // cannot join, and the queue filters on who the clip belongs to.
        { key: "athlete_id", type: "string", size: 36, required: true },
        { key: "set_id", type: "string", size: 36, required: true },
        { key: "reviewed_at", type: "datetime", required: true },
        // Derived from coach and set rather than random, so clearing the same
        // clip twice -- a double tap, a replayed request -- is one row.
        { key: "client_review_id", type: "string", size: 80, required: true },
      ],
      indexes: [
        { key: "idx_coach_reviewed", type: "key", columns: ["coach_id", "reviewed_at"], orders: ["asc", "desc"] },
        { key: "idx_client_review_id", type: "unique", columns: ["client_review_id"] },
      ],
    },

    {
      id: "set_comments",
      name: "Set comments",
      purpose:
        "What the coach says about a filmed set, anchored to the set rather than sitting in an inbox. This is the WhatsApp thread, and the reason it can be short: the set already carries load, reps, RPE and the athlete's note, so none of the context has to be typed.",
      rowSecurity: true,
      permissions: [perm.createUsers],
      columns: [
        { key: "set_id", type: "string", size: 36, required: true },
        // Whose set it is, not who wrote the comment. Denormalised because the
        // athlete's feedback screen at Order 34 reads by athlete, and Appwrite
        // cannot join back to the set to find out.
        { key: "athlete_id", type: "string", size: 36, required: true },
        { key: "author_id", type: "string", size: 36, required: true },
        // Long enough for a paragraph of form feedback. `sets.notes` is 500
        // because an athlete taps it out mid-set; this replaces the essay
        // Joey currently types into WhatsApp, and truncating a coach's
        // correction is the kind of bug that ends with them retyping it.
        { key: "body", type: "string", size: 2000, required: true },
        // Null on the coach's opening comment; the parent's id on a reply.
        // Threading is modelled now even though only Order 34 draws it, because
        // adding the column later means backfilling every comment ever written.
        { key: "parent_id", type: "string", size: 36, required: false },
        { key: "created_at", type: "datetime", required: true },
        { key: "client_comment_id", type: "string", size: 80, required: true },
      ],
      indexes: [
        { key: "idx_set_created", type: "key", columns: ["set_id", "created_at"], orders: ["asc", "asc"] },
        { key: "idx_athlete_created", type: "key", columns: ["athlete_id", "created_at"], orders: ["asc", "desc"] },
        { key: "idx_client_comment_id", type: "unique", columns: ["client_comment_id"] },
      ],
    },

    {
      id: "bodyweight_entries",
      name: "Bodyweight entries",
      purpose:
        "One weigh-in per athlete per day. Exists because Ruairi said he currently has to ask athletes what they weigh -- so the job is to make the number appear on his Athlete View without him asking.",
      rowSecurity: true,
      permissions: [perm.createUsers],
      columns: [
        { key: "athlete_id", type: "string", size: 36, required: true },
        // Stored in kilograms like every other weight in the product. The
        // profile's units setting is a display preference and never reaches
        // storage, so a switch to pounds cannot rewrite anyone's history.
        { key: "weight_kg", type: "float", required: true, min: 20, max: 400 },
        // The DAY it refers to, as YYYY-MM-DD, not a timestamp. A weigh-in
        // belongs to a morning rather than to an instant, and a date string is
        // what makes "one per day" expressible as an id.
        { key: "measured_on", type: "string", size: 10, required: true },
        // When it was actually typed. Differs from measured_on when somebody
        // catches up on yesterday's weight, and is what a coach would want if
        // two numbers ever disagreed.
        { key: "recorded_at", type: "datetime", required: true },
      ],
      indexes: [
        {
          key: "idx_athlete_measured",
          type: "key",
          columns: ["athlete_id", "measured_on"],
          orders: ["asc", "desc"],
        },
        // Belt and braces. The row id already encodes athlete and day, so a
        // second entry for the same morning cannot be written -- this says so
        // in the schema as well, where the next person looks.
        { key: "idx_one_per_day", type: "unique", columns: ["athlete_id", "measured_on"] },
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
      id: "reference_maxes",
      name: "Reference maxes",
      purpose:
        "What a percentage is a percentage OF. Append-only with effective dates, not a number on a profile, so a block written in August still explains itself in October. Only tested and training live here -- estimated is the best e1RM in stats_rollups and is never stored twice.",
      rowSecurity: true,
      // No table-level create, like invite_codes: Appwrite can police who
      // reads a row but not what the row claims, so a client that could create
      // one could create it carrying somebody else's athlete_id.
      permissions: [],
      columns: [
        { key: "athlete_id", type: "string", size: 36, required: true },
        // Per exercise, not per base lift: the Order 17 ticket is explicit
        // that "a variation is its own exercise, so a max is held per
        // exercise". Whether a percentage ON a variation may point at the base
        // lift's max is [SME to confirm] with Ruairi, and belongs to the
        // prescription at Order 18 -- not modelled here.
        { key: "exercise_id", type: "string", size: 36, required: true },
        // Deliberately two values, not three. "Estimated" is the best e1RM in
        // stats_rollups; making it writable here would be a second
        // implementation of an aggregate, which is how the rebuild script
        // stops being the repair path.
        { key: "kind", type: "enum", elements: ["tested", "training"], required: true },
        { key: "value_kg", type: "float", required: true, min: 0 },
        // The date it applies from, which is not the date it was typed: a
        // coach entering Monday's test on Wednesday means Monday.
        { key: "effective_from", type: "datetime", required: true },
        // Coach or athlete. Kept because "who decided this number" is the
        // first question asked when a percentage looks wrong.
        { key: "recorded_by", type: "string", size: 36, required: true },
        { key: "created_at", type: "datetime", required: true },
      ],
      indexes: [
        {
          key: "idx_athlete_exercise_kind",
          type: "key",
          columns: ["athlete_id", "exercise_id", "kind"],
        },
        // The current max is the newest one that has come into effect, so the
        // sort is part of the question and belongs in the index.
        {
          key: "idx_athlete_effective",
          type: "key",
          columns: ["athlete_id", "effective_from"],
          orders: ["asc", "desc"],
        },
      ],
    },

    /* ---------------------------------------------------------------------
     * Programming (Order 19). Coach-authored, server-written only.
     *
     * Every child row carries program_id, coach_id and athlete_id, copied from
     * the program by the write helper -- the same rule as athlete_id on sets.
     * Appwrite cannot join, and the permission stamp needs both ids without a
     * read.
     * ------------------------------------------------------------------ */

    {
      id: "programs",
      name: "Programs",
      purpose:
        "The root of a coach's programming. athlete_id null is a template -- the same rows, unassigned -- so reusable skeletons need no second model if Ruairi turns out to reuse them. Written only by the server: Appwrite can police who reads a row but not what it claims, so a client able to create one could put a program on somebody else's Today.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "coach_id", type: "string", size: 36, required: true },
        // Null for a template. Assigning one is a copy, never an update, so a
        // template edited later cannot reach into an athlete's live block.
        { key: "athlete_id", type: "string", size: 36, required: false },
        { key: "name", type: "string", size: 120, required: true },
        // Draft until published, so a half-written block never reaches an
        // athlete's Today. Archived rather than deleted: sessions point here.
        { key: "status", type: "enum", elements: ["draft", "published", "archived"], required: true },
        // YYYY-MM-DD. Informational: the calendar lives on each day, which is
        // what lets session-by-session writing work without this.
        { key: "start_on", type: "string", size: 10, required: false },
        { key: "notes", type: "string", size: 2000, required: false },
        // The template this was copied from, if any. Lineage only.
        { key: "template_id", type: "string", size: 36, required: false },
        { key: "created_at", type: "datetime", required: true },
        { key: "updated_at", type: "datetime", required: true },
      ],
      indexes: [
        { key: "idx_athlete_status", type: "key", columns: ["athlete_id", "status"] },
        { key: "idx_coach_updated", type: "key", columns: ["coach_id", "updated_at"], orders: ["asc", "desc"] },
      ],
    },

    {
      id: "program_blocks",
      name: "Program blocks",
      purpose:
        "A training block inside a program (volume, intensity, peak). Ordered by position. Week count is not stored -- it is how many weeks point here, and a stored copy is a number that drifts the first time a week is added.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "program_id", type: "string", size: 36, required: true },
        { key: "coach_id", type: "string", size: 36, required: true },
        { key: "athlete_id", type: "string", size: 36, required: false },
        { key: "position", type: "integer", required: true, min: 0 },
        { key: "name", type: "string", size: 80, required: true },
        { key: "notes", type: "string", size: 2000, required: false },
      ],
      indexes: [{ key: "idx_program_position", type: "key", columns: ["program_id", "position"] }],
    },

    {
      id: "program_weeks",
      name: "Program weeks",
      purpose:
        "A week is a row, not a number on a day, so it can be written, published and later duplicated on its own. Per-week status is what makes week-by-week writing possible without a migration: publish week 3 while week 4 is still a draft.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "program_id", type: "string", size: 36, required: true },
        { key: "block_id", type: "string", size: 36, required: true },
        { key: "coach_id", type: "string", size: 36, required: true },
        { key: "athlete_id", type: "string", size: 36, required: false },
        { key: "position", type: "integer", required: true, min: 0 },
        { key: "label", type: "string", size: 80, required: false },
        { key: "status", type: "enum", elements: ["draft", "published"], required: true },
        { key: "notes", type: "string", size: 2000, required: false },
      ],
      indexes: [
        { key: "idx_program", type: "key", columns: ["program_id"] },
        { key: "idx_block_position", type: "key", columns: ["block_id", "position"] },
      ],
    },

    {
      id: "program_days",
      name: "Program days",
      purpose:
        "One prescribed session. Carries its own calendar date rather than deriving it from a start date plus offsets, so a block written up front, a week written on Sunday and a session written the night before are all the same row. Null date on a template.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "program_id", type: "string", size: 36, required: true },
        { key: "block_id", type: "string", size: 36, required: true },
        { key: "week_id", type: "string", size: 36, required: true },
        { key: "coach_id", type: "string", size: 36, required: true },
        { key: "athlete_id", type: "string", size: 36, required: false },
        { key: "position", type: "integer", required: true, min: 0 },
        { key: "label", type: "string", size: 80, required: false },
        // YYYY-MM-DD, the athlete's own calendar day. A date and not a
        // timestamp: a session belongs to a day, and Today asks "what is on
        // 2026-09-27", not "what is between two instants in some timezone".
        { key: "scheduled_on", type: "string", size: 10, required: false },
        // The coach's note for the day, shown under the card on Today -- the
        // closest the app gets to the coach being in the room.
        { key: "notes", type: "string", size: 2000, required: false },
      ],
      indexes: [
        // Today's one question, as an index.
        { key: "idx_athlete_scheduled", type: "key", columns: ["athlete_id", "scheduled_on"] },
        { key: "idx_program", type: "key", columns: ["program_id"] },
        { key: "idx_week_position", type: "key", columns: ["week_id", "position"] },
      ],
    },

    {
      id: "prescriptions",
      name: "Prescriptions",
      purpose:
        "One line of a day: an exercise, a set count, reps, and the load cell exactly as the coach typed it. A top set and its backoffs are two lines, as in the spreadsheet. Mutable by design -- logged sets carry their own snapshot, so editing a line never rewrites what an athlete did.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "program_id", type: "string", size: 36, required: true },
        { key: "week_id", type: "string", size: 36, required: true },
        { key: "day_id", type: "string", size: 36, required: true },
        { key: "coach_id", type: "string", size: 36, required: true },
        { key: "athlete_id", type: "string", size: 36, required: false },
        { key: "exercise_id", type: "string", size: 36, required: true },
        { key: "position", type: "integer", required: true, min: 0 },
        { key: "set_count", type: "integer", required: true, min: 1, max: 50 },
        // Reps, or the bottom of a range when rep_max is set. Null when the
        // load cell says it all ("work up to a heavy single").
        { key: "reps", type: "integer", required: false, min: 1, max: 100 },
        { key: "rep_max", type: "integer", required: false, min: 1, max: 100 },
        // The load cell as typed: "75% @8", "142.5", "@8", or freeform. The
        // text is canonical because freeform has nothing else, and Order 18's
        // parse and format round-trip, so the structured form is derived.
        { key: "load", type: "string", size: 120, required: false },
        // Derived from `load` by the write helper, never by the caller, so it
        // cannot disagree with the text. Stored for the "what did my typing
        // land as" indicator Order 18 owes the coach.
        {
          key: "load_kind",
          type: "enum",
          elements: ["fixed", "percent", "rpe", "capped", "freeform"],
          required: false,
        },
        { key: "rest_seconds", type: "integer", required: false, min: 0, max: 3600 },
        { key: "notes", type: "string", size: 500, required: false },
        { key: "updated_at", type: "datetime", required: true },
      ],
      indexes: [
        { key: "idx_day_position", type: "key", columns: ["day_id", "position"] },
        { key: "idx_program", type: "key", columns: ["program_id"] },
        { key: "idx_week", type: "key", columns: ["week_id"] },
      ],
    },

    {
      id: "invite_codes",
      name: "Invite codes",
      purpose:
        "A coach's code, shared with an athlete out of band. The code IS the row id, so uniqueness comes from the primary key and redeeming one is a point read rather than a query. Written only server side: a code an athlete could mint is a coach they could invent.",
      rowSecurity: true,
      permissions: [],
      columns: [
        { key: "coach_id", type: "string", size: 36, required: true },
        { key: "created_at", type: "datetime", required: true },
      ],
      // One code per coach. The blueprint shows a single code on Profile, and
      // a unique index is what stops a retried mint from leaving a coach with
      // two live codes and no way to tell which one they gave out.
      indexes: [{ key: "idx_coach", type: "unique", columns: ["coach_id"] }],
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

  buckets: [
    {
      id: "set_videos",
      name: "Set videos",
      purpose:
        "A clip attached to one logged set. The highest-value thing in the product -- neither RTS nor Excel does it -- and the reason the essay-length WhatsApp message disappears: the set already carries load, reps, RPE and notes, so the context writes itself.",
      // Per file, like row security on a table: the reader differs per clip.
      // An athlete's video is theirs and their circle's, never the roster's.
      fileSecurity: true,
      permissions: [perm.createUsers],
      /**
       * Tracks `_APP_STORAGE_LIMIT` on the instance, which is the hard ceiling
       * -- Appwrite rejects a bucket asking for more than the instance allows.
       *
       * It was 30,000,000 (Appwrite's default) until 15 Sep 2026, which is not
       * enough for a 60-second 1080p phone clip. Joey raised the instance to
       * 200MB when uploads moved to the NAS, so this follows. Client-side
       * compression at Order 31 should bring real clips far below it; this is
       * the ceiling, not the target.
       *
       * If a bucket create or update starts failing with "Invalid
       * maximumFileSize", the instance limit moved and this is what has to
       * change.
       */
      maximumFileSizeBytes: 200_000_000,
      // What a phone camera produces. Deliberately narrow: an athlete who
      // manages to attach a PDF has found a bug, not a feature.
      allowedFileExtensions: ["mp4", "mov", "m4v", "webm"],
      // Video is already compressed; gzip over it burns CPU at both ends to
      // save nothing.
      compression: "none",
      /**
       * Both off deliberately. Appwrite skips encryption above 20MB, so
       * turning it on would encrypt short clips and silently not long ones --
       * a guarantee that holds only sometimes is worse than none. Antivirus
       * needs ClamAV running beside the instance, which this one does not
       * have, and claiming it here would make every apply report drift it
       * cannot fix.
       */
      encryption: false,
      antivirus: false,
    },
  ],
} as const;

export const TABLES = Object.fromEntries(schema.tables.map((t) => [t.id, t.id])) as Record<
  (typeof schema.tables)[number]["id"],
  string
>;
