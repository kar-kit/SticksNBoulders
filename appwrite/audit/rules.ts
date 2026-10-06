import { POLICIES } from "../documents/policy";
import { expectedStamp } from "../documents/provenance";

/**
 * The permission audit's expectations: for every table and bucket, which of
 * five real roles may read, create, update and delete ATHLETE A's data.
 *
 * Pure data and pure functions, so the rules can be unit tested without a
 * network and the runner (scripts/appwrite-audit.mts) is only the part that
 * talks to Appwrite. The rules restate policy.ts in terms of outcomes on
 * purpose: the policy says which strings are stamped, this says what those
 * strings must add up to once Appwrite has applied them. Deriving one from
 * the other would make the audit agree with whatever the policy happens to
 * be, which is the tautology that let the old probe pass 19/19.
 *
 * Every operation is judged from the attacker's side. "create" does not mean
 * "can this person create a row in this table" -- anyone signed in can create
 * a set. It means "can this person put a row into A's data that A and A's
 * coach will then read as A's". For anyone but the owner that is a forgery,
 * attempted with the strongest permissions the forger is able to stamp.
 */

export const ACTORS = ["athlete", "coach", "unlinkedCoach", "otherAthlete", "anon"] as const;
export type AuditActor = (typeof ACTORS)[number];

/** Column headers, kept short enough for an 80-column terminal. */
export const ACTOR_LABELS: Record<AuditActor, string> = {
  athlete: "athlete A",
  coach: "A's coach",
  unlinkedCoach: "unlinked",
  otherAthlete: "athlete B",
  anon: "anon",
};

export const OPS = ["read", "create", "update", "delete"] as const;
export type AuditOp = (typeof OPS)[number];

export type ResourceKind = "table" | "bucket";

export interface ResourceRule {
  /** Unique within RULES. A table may have more than one target. */
  key: string;
  kind: ResourceKind;
  /** The table or bucket id this rule covers. */
  resource: string;
  /** What the audited row or file is, in words. */
  target: string;
  /** Who is expected to succeed. Everyone else is expected to be refused. */
  allow: Record<AuditOp, readonly AuditActor[]>;
  /**
   * The column naming whose data a row is, for the "sees nothing" sweep: an
   * outsider filtering on it for athlete A must get zero rows back.
   */
  ownerColumn?: string;
  /**
   * A per-row invariant checked during the stored-stamp scan, on every row of
   * the table. Returns what is wrong, or null. For the facts a stamp cannot
   * carry: a column's allowed values, a child agreeing with its parent.
   */
  invariant?: (row: Record<string, unknown>) => string | null;
  /** Why the less obvious cells are what they are. */
  notes?: string;
}

const owner = ["athlete"] as const;
const athleteAndCoach = ["athlete", "coach"] as const;
const nobody = [] as const;

/**
 * Athlete-owned logged work: readable by the athlete and their circle,
 * written by the athlete alone. CLAUDE.md constraint 5 -- logged work is
 * immutable to the coach.
 */
const loggedWork = {
  read: athleteAndCoach,
  create: owner,
  update: owner,
  delete: owner,
} as const;

/** Written only with the API key, behind a route. No session writes at all. */
const serverOnly = (read: readonly AuditActor[]) => ({
  read,
  create: nobody,
  update: nobody,
  delete: nobody,
});

/**
 * Order 19: five tables, one document. Written only by /api/program, which
 * checks the caller is the program's coach on an active link; read by the
 * coach, the athlete and the athlete's circle. The coach's read survives a
 * revoked link by design (policy.ts, programPermissions).
 */
const programTable = (resource: string, target: string): ResourceRule => ({
  key: resource,
  kind: "table",
  resource,
  target,
  allow: serverOnly(athleteAndCoach),
  ownerColumn: "athlete_id",
  notes: "Programs are archived, never deleted; a child row's coach_id and athlete_id must match its program's.",
});

export const RULES: readonly ResourceRule[] = [
  {
    key: "profiles",
    kind: "table",
    resource: "profiles",
    target: "A's profile",
    allow: loggedWork,
    ownerColumn: "user_id",
    notes:
      "A forged second profile collides with the unique index on user_id, so the create cells can only " +
      "test the case where A already has one.",
  },
  {
    key: "exercises",
    kind: "table",
    resource: "exercises",
    target: "a custom exercise A typed mid-session",
    allow: loggedWork,
    ownerColumn: "owner_id",
  },
  {
    key: "exercises:library",
    kind: "table",
    resource: "exercises",
    target: "a shared library exercise (is_global)",
    allow: {
      read: ["athlete", "coach", "unlinkedCoach", "otherAthlete"],
      // Curating the library is an admin job. A signed-in user who can create
      // a global row can put a name in every athlete's typeahead.
      create: nobody,
      update: nobody,
      delete: nobody,
    },
  },
  {
    key: "sessions",
    kind: "table",
    resource: "sessions",
    target: "A's training session",
    allow: loggedWork,
    ownerColumn: "athlete_id",
  },
  {
    key: "sets",
    kind: "table",
    resource: "sets",
    target: "A's logged set",
    allow: loggedWork,
    ownerColumn: "athlete_id",
  },
  {
    key: "bodyweight_entries",
    kind: "table",
    resource: "bodyweight_entries",
    target: "A's weigh-in",
    allow: loggedWork,
    ownerColumn: "athlete_id",
  },
  {
    key: "set_reviews",
    kind: "table",
    resource: "set_reviews",
    target: "the coach's 'cleared' mark on A's clip",
    allow: {
      // Stamped read(team:circle_A): the athlete is in the circle too.
      read: athleteAndCoach,
      create: ["coach"],
      update: ["coach"],
      delete: ["coach"],
    },
    ownerColumn: "athlete_id",
    notes: "Clearing a coach's queue is not something the person being coached gets to do (policy.ts).",
  },
  {
    key: "set_comments",
    kind: "table",
    resource: "set_comments",
    target: "the coach's comment on A's set",
    allow: {
      read: athleteAndCoach,
      // The coach opens the thread, the athlete replies. Both are real writes.
      create: athleteAndCoach,
      // The author owns their own words and nobody else's.
      update: ["coach"],
      delete: ["coach"],
    },
    ownerColumn: "athlete_id",
  },
  {
    key: "stats_rollups",
    kind: "table",
    resource: "stats_rollups",
    target: "A's weekly rollup, written by /api/rollup",
    allow: serverOnly(athleteAndCoach),
    ownerColumn: "athlete_id",
    notes: "A forged rollup is a forged PR.",
  },
  {
    key: "reference_maxes",
    kind: "table",
    resource: "reference_maxes",
    target: "the training max A's coach set, via /api/reference-max",
    allow: serverOnly(athleteAndCoach),
    ownerColumn: "athlete_id",
    notes: "Append-only: not even the coach who set it edits it in place.",
  },
  {
    key: "invite_codes",
    kind: "table",
    resource: "invite_codes",
    target: "A's coach's invite code, via /api/invite",
    allow: serverOnly(["coach"]),
    ownerColumn: "coach_id",
    notes: "The athlete never reads a code row; redemption looks it up with the API key.",
  },
  {
    key: "coach_athlete_links",
    kind: "table",
    resource: "coach_athlete_links",
    target: "the A-coach link, via /api/link",
    allow: serverOnly(athleteAndCoach),
    ownerColumn: "athlete_id",
    // Order 28: the one column a coach may change after linking, through
    // /api/link/suggestions only. Anything else here is a corrupt link.
    invariant: (row) =>
      row.suggestions_mode == null || row.suggestions_mode === "direct" || row.suggestions_mode === "held"
        ? null
        : `suggestions_mode is ${JSON.stringify(row.suggestions_mode)}`,
    notes: "Each row carries exactly the two parties' reads: no update, delete, team or users grant.",
  },
  programTable("programs", "the program A's coach wrote for A, via /api/program"),
  programTable("program_blocks", "a block of that program"),
  programTable("program_weeks", "a week of that program"),
  programTable("program_days", "a day of that program"),
  programTable("prescriptions", "a prescribed line of that program"),
  {
    key: "set_videos",
    kind: "bucket",
    resource: "set_videos",
    target: "a clip on A's set",
    allow: {
      read: athleteAndCoach,
      create: owner,
      // No update permission is stamped on a clip for anybody.
      update: nobody,
      // The athlete may delete; a reviewer who could destroy the thing under
      // review is the wrong shape.
      delete: owner,
    },
    notes:
      "A file names no athlete by itself, so the create cells ask whether an outsider can upload a clip " +
      "stamped with A's permissions -- not whether they can upload at all.",
  },
];

/* -------------------------------------------------------------------------
 * Coverage
 * ---------------------------------------------------------------------- */

export interface DiscoveredResource {
  id: string;
  kind: ResourceKind;
}

export interface Coverage {
  /** Present in the schema or on the instance, with no rule. A failure. */
  uncovered: DiscoveredResource[];
  /** A rule for something that exists nowhere. Also a failure: a stale rule audits nothing. */
  stale: ResourceRule[];
}

export function coverage(
  resources: readonly DiscoveredResource[],
  rules: readonly ResourceRule[] = RULES,
): Coverage {
  const has = (kind: ResourceKind, id: string) =>
    resources.some((r) => r.kind === kind && r.id === id);
  const ruled = (r: DiscoveredResource) =>
    rules.some((rule) => rule.kind === r.kind && rule.resource === r.id);
  return {
    uncovered: dedupe(resources).filter((r) => !ruled(r)),
    stale: rules.filter((rule) => !has(rule.kind, rule.resource)),
  };
}

function dedupe(resources: readonly DiscoveredResource[]): DiscoveredResource[] {
  const seen = new Set<string>();
  return resources.filter((r) => {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* -------------------------------------------------------------------------
 * Judging an attempt
 * ---------------------------------------------------------------------- */

export type Outcome =
  | { kind: "allowed" }
  | { kind: "denied"; code: number }
  /**
   * Appwrite accepted the write, and it changed nothing anyone will read:
   * the row fails the authorship check every reader applies
   * (appwrite/documents/provenance.ts). Counts as a refusal. Whether the
   * validate-row Function then deleted it is asserted separately, with a
   * bounded wait, because the two defences are independent.
   */
  | { kind: "neutralised"; reason: string }
  /** Neither proof of access nor proof of refusal. Always a failure. */
  | { kind: "error"; message: string };

/**
 * What an Appwrite error means for the audit.
 *
 * 401 and 403 are refusals. 404 is too, on a row the caller cannot read --
 * Appwrite answers "not found" rather than confirming the row exists. 409 is
 * a refusal by the schema (a unique index) rather than by permissions, which
 * still means the forgery did not land. Anything else -- a 400 for a malformed
 * row, a 500 -- proves nothing either way, and is reported as an error so a
 * broken fixture can never pass as a denial.
 */
export function classifyError(error: unknown): Outcome {
  const code = typeof (error as { code?: unknown })?.code === "number" ? (error as { code: number }).code : 0;
  if (code === 401 || code === 403 || code === 404 || code === 409) return { kind: "denied", code };
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "error", message: code ? `${code} ${message}` : message };
}

export function passes(expectedAllowed: boolean, outcome: Outcome): boolean {
  if (outcome.kind === "error") return false;
  return expectedAllowed === (outcome.kind === "allowed");
}

export function isAllowed(rule: ResourceRule, op: AuditOp, actor: AuditActor): boolean {
  return rule.allow[op].includes(actor);
}

/* -------------------------------------------------------------------------
 * The matrix
 * ---------------------------------------------------------------------- */

export interface Cell {
  rule: string;
  op: AuditOp;
  actor: AuditActor;
  expected: boolean;
  outcome: Outcome;
  /** What was attempted, for the failure list. */
  how: string;
}

const symbol = (cell: Cell | undefined): string => {
  if (!cell) return "-";
  const seen =
    cell.outcome.kind === "allowed"
      ? "yes"
      : cell.outcome.kind === "denied"
        ? "no"
        : cell.outcome.kind === "neutralised"
          ? "landed*"
          : "ERR";
  return passes(cell.expected, cell.outcome) ? seen : `${seen} FAIL`;
};

/**
 * One line per resource and operation, one column per role. A cell reads
 * "yes" or "no" for what actually happened, with FAIL beside it when that was
 * not what the rule expected.
 */
export function formatMatrix(cells: readonly Cell[], rules: readonly ResourceRule[] = RULES): string {
  const first = Math.max(...rules.map((r) => r.key.length), "resource".length) + 2;
  const col = 12;
  const pad = (s: string, n: number) => s.padEnd(n);
  const header =
    pad("resource", first) + pad("op", 8) + ACTORS.map((a) => pad(ACTOR_LABELS[a], col)).join("");
  const lines = [header, "-".repeat(header.length)];
  for (const rule of rules) {
    const ruleCells = cells.filter((c) => c.rule === rule.key);
    if (ruleCells.length === 0) continue;
    for (const op of OPS) {
      const row = ACTORS.map((actor) =>
        pad(symbol(ruleCells.find((c) => c.op === op && c.actor === actor)), col),
      ).join("");
      lines.push(pad(op === "read" ? rule.key : "", first) + pad(op, 8) + row.trimEnd());
    }
  }
  return lines.join("\n");
}

export function failedCells(cells: readonly Cell[]): Cell[] {
  return cells.filter((c) => !passes(c.expected, c.outcome));
}

export function describeFailure(cell: Cell): string {
  const who = ACTOR_LABELS[cell.actor];
  const expected = cell.expected ? "should succeed" : "should be refused";
  const got =
    cell.outcome.kind === "allowed"
      ? "it succeeded"
      : cell.outcome.kind === "denied"
        ? `it was refused (${cell.outcome.code})`
        : cell.outcome.kind === "neutralised"
          ? `it landed but no reader trusts it (${cell.outcome.reason})`
          : `it errored: ${cell.outcome.message}`;
  return `${cell.rule} / ${cell.op} / ${who}: ${cell.how} -- ${expected}, ${got}`;
}

/* -------------------------------------------------------------------------
 * Stored stamps
 * ---------------------------------------------------------------------- */

/**
 * Tables expectedStamp can derive a stamp for. A table missing from here is
 * reported by the scan rather than skipped, so a new table cannot quietly
 * escape it.
 */
export const STAMPED_TABLES: readonly string[] = Object.keys(POLICIES);

/** Moved to appwrite/documents/provenance.ts so the readers and the validate-row Function share it. */
export { expectedStamp };

export interface StampDrift {
  missing: string[];
  extra: string[];
}

/** Order-insensitive. Appwrite does not promise to return permissions as stamped. */
export function stampDrift(expected: readonly string[], actual: readonly string[]): StampDrift {
  const want = new Set(expected);
  const have = new Set(actual);
  return {
    missing: [...want].filter((p) => !have.has(p)),
    extra: [...have].filter((p) => !want.has(p)),
  };
}
