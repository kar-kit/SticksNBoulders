import { schema } from "../schema";
import { circleTeamId } from "../documents/circle";
import { SERVER_ONLY_TABLES, USER_WRITABLE_TABLES, videoPermissions } from "../documents/policy";
import {
  ACTORS,
  ACTOR_LABELS,
  OPS,
  RULES,
  STAMPED_TABLES,
  classifyError,
  coverage,
  describeFailure,
  expectedStamp,
  failedCells,
  formatMatrix,
  isAllowed,
  passes,
  stampDrift,
  type Cell,
} from "./rules";

const A = "athlete_a";
const C = "coach_c";

describe("the audit's rules", () => {
  it("has a unique key per rule", () => {
    const keys = RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every table and bucket in the schema-as-code", () => {
    const declared = [
      ...schema.tables.map((t) => ({ id: t.id, kind: "table" as const })),
      ...schema.buckets.map((b) => ({ id: b.id, kind: "bucket" as const })),
    ];
    expect(coverage(declared)).toEqual({ uncovered: [], stale: [] });
  });

  it("never expects the anonymous client to do anything", () => {
    for (const rule of RULES) {
      for (const op of OPS) expect(isAllowed(rule, op, "anon"), `${rule.key} ${op}`).toBe(false);
    }
  });

  it("never lets an outsider near A's data", () => {
    for (const rule of RULES.filter((r) => r.key !== "exercises:library")) {
      for (const op of OPS) {
        expect(isAllowed(rule, op, "unlinkedCoach"), `${rule.key} ${op}`).toBe(false);
        expect(isAllowed(rule, op, "otherAthlete"), `${rule.key} ${op}`).toBe(false);
      }
    }
  });

  it("never lets a coach rewrite logged work", () => {
    for (const key of ["sessions", "sets", "bodyweight_entries", "profiles", "exercises"]) {
      const rule = RULES.find((r) => r.key === key)!;
      expect(isAllowed(rule, "update", "coach"), key).toBe(false);
      expect(isAllowed(rule, "delete", "coach"), key).toBe(false);
    }
  });

  it("expects no session to write a server-only table, which is what policy.ts declares", () => {
    for (const table of SERVER_ONLY_TABLES) {
      const rule = RULES.find((r) => r.resource === table)!;
      for (const op of ["create", "update", "delete"] as const) {
        expect(rule.allow[op], `${table} ${op}`).toEqual([]);
      }
    }
  });

  it("expects somebody to write every user-writable table from a session, so a broken write path fails", () => {
    for (const table of USER_WRITABLE_TABLES) {
      const writable = RULES.filter((r) => r.resource === table).some((r) => r.allow.create.length > 0);
      expect(writable, table).toBe(true);
    }
  });
});

describe("coverage", () => {
  it("reports a table another branch added without a rule", () => {
    const result = coverage([
      { id: "sets", kind: "table" },
      { id: "programs", kind: "table" },
    ]);
    expect(result.uncovered).toEqual([{ id: "programs", kind: "table" }]);
  });

  it("counts a table found in both schema and instance once", () => {
    const result = coverage([
      { id: "programs", kind: "table" },
      { id: "programs", kind: "table" },
    ]);
    expect(result.uncovered).toHaveLength(1);
  });

  it("reports a rule for something that no longer exists", () => {
    const result = coverage([{ id: "sets", kind: "table" }]);
    expect(result.stale.map((r) => r.key)).toContain("set_videos");
  });

  it("does not let a table satisfy a bucket rule of the same name", () => {
    const result = coverage([{ id: "set_videos", kind: "table" }]);
    expect(result.uncovered).toEqual([{ id: "set_videos", kind: "table" }]);
  });
});

describe("classifying an attempt", () => {
  it.each([401, 403, 404, 409])("treats %i as a refusal", (code) => {
    expect(classifyError({ code, message: "no" })).toEqual({ kind: "denied", code });
  });

  it("never lets a malformed fixture pass as a refusal", () => {
    const outcome = classifyError(Object.assign(new Error("Invalid document structure"), { code: 400 }));
    expect(outcome.kind).toBe("error");
    expect(passes(false, outcome)).toBe(false);
    expect(passes(true, outcome)).toBe(false);
  });

  it("treats a thrown thing without a code as an error", () => {
    expect(classifyError(new Error("socket hang up")).kind).toBe("error");
  });

  it("passes only when what happened is what was expected", () => {
    expect(passes(true, { kind: "allowed" })).toBe(true);
    expect(passes(false, { kind: "denied", code: 401 })).toBe(true);
    expect(passes(false, { kind: "allowed" })).toBe(false);
    expect(passes(true, { kind: "denied", code: 401 })).toBe(false);
  });
});

describe("the matrix", () => {
  const cell = (over: Partial<Cell>): Cell => ({
    rule: "sets",
    op: "read",
    actor: "athlete",
    expected: true,
    outcome: { kind: "allowed" },
    how: "get the target by id",
    ...over,
  });

  it("prints one column per role and flags only the cells that disagree", () => {
    const cells = [
      cell({}),
      cell({ actor: "coach" }),
      cell({ actor: "otherAthlete", expected: false, outcome: { kind: "denied", code: 404 } }),
      cell({ op: "create", actor: "otherAthlete", expected: false, outcome: { kind: "allowed" } }),
    ];
    const out = formatMatrix(cells);
    for (const actor of ACTORS) expect(out.split("\n")[0]).toContain(ACTOR_LABELS[actor]);
    const read = out.split("\n").find((l) => l.startsWith("sets"))!;
    expect(read).toMatch(/read\s+yes\s+yes\s+-\s+no/);
    const create = out.split("\n").find((l) => /^\s+create/.test(l))!;
    expect(create).toContain("yes FAIL");
    expect(failedCells(cells)).toHaveLength(1);
  });

  it("describes a failure in words a reviewer can act on", () => {
    const text = describeFailure(
      cell({ op: "create", actor: "otherAthlete", expected: false, how: "createRow naming A" }),
    );
    expect(text).toBe("sets / create / athlete B: createRow naming A -- should be refused, it succeeded");
  });

  it("omits resources with no cells rather than printing an empty block", () => {
    expect(formatMatrix([cell({})])).not.toContain("set_videos");
  });
});

describe("stored stamps", () => {
  it("derives the stamp every table's write path uses", () => {
    expect(expectedStamp("sets", { athlete_id: A })).toEqual([
      `read("user:${A}")`,
      `read("team:${circleTeamId(A)}")`,
      `update("user:${A}")`,
      `delete("user:${A}")`,
    ]);
    expect(expectedStamp("set_comments", { athlete_id: A, author_id: C })).toContain(`update("user:${C}")`);
    expect(expectedStamp("exercises", { is_global: true })).toEqual(['read("users")', 'update("team:library")']);
    expect(expectedStamp("exercises", { is_global: false, owner_id: A })).toContain(`update("user:${A}")`);
  });

  it("knows every table in the schema, so a new one cannot escape the scan", () => {
    for (const table of schema.tables) expect(STAMPED_TABLES, table.id).toContain(table.id);
    for (const table of STAMPED_TABLES) expect(expectedStamp(table, {})).toBeNull();
  });

  it("reports a row missing its owner rather than guessing", () => {
    expect(expectedStamp("sets", { athlete_id: "" })).toBeNull();
  });

  it("finds a forged row: stamped for everybody instead of for its athlete", () => {
    const forged = ['read("users")'];
    const drift = stampDrift(expectedStamp("sets", { athlete_id: A })!, forged);
    expect(drift.extra).toEqual(['read("users")']);
    expect(drift.missing).toHaveLength(4);
  });

  it("ignores order, which Appwrite does not preserve", () => {
    const want = videoPermissions({ athleteId: A });
    expect(stampDrift(want, [...want].reverse())).toEqual({ missing: [], extra: [] });
  });
});
