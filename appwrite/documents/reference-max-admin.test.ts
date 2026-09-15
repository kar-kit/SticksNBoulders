import {
  mayWriteFor,
  removeReferenceMax,
  setReferenceMax,
  type ReferenceMaxTables,
} from "./reference-max-admin";
import { circleTeamId } from "./circle";

const DB = "sticksnboulders";
const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const STRANGER = "coach_louis";
const EXERCISE = "ex-squat";

interface Row extends Record<string, unknown> {
  $id: string;
}

const activeLink = (coachId: string, athleteId: string): Row => ({
  $id: `link_${coachId}_${athleteId}`,
  coach_id: coachId,
  athlete_id: athleteId,
  status: "active",
});

/** Enough of Appwrite to exercise every branch, failures included. */
function harness(options: { links?: Row[]; maxes?: Row[] } = {}) {
  const links: Row[] = [...(options.links ?? [activeLink(COACH, ATHLETE)])];
  const maxes: Row[] = [...(options.maxes ?? [])];
  const writes: Array<{ op: string; data: Record<string, unknown>; permissions?: string[] }> = [];
  let nextId = 0;

  const tables: ReferenceMaxTables = {
    async listRows({ tableId, queries }) {
      if (tableId !== "coach_athlete_links") return { rows: [] };
      // The double reads the queries rather than ignoring them, so a missing
      // status filter in the module under test shows up as a test failure
      // rather than as a permissive stub.
      const wanted = Object.fromEntries(
        queries
          .map((q) => JSON.parse(q) as { method?: string; attribute?: string; values?: unknown[] })
          .filter((q) => q.method === "equal" && q.attribute)
          .map((q) => [q.attribute as string, q.values?.[0]]),
      );
      return {
        rows: links.filter((row) =>
          Object.entries(wanted).every(([key, value]) => row[key] === value),
        ),
      };
    },
    async getRow({ tableId, rowId }) {
      const row = tableId === "reference_maxes" ? maxes.find((m) => m.$id === rowId) : null;
      if (!row) throw Object.assign(new Error("not found"), { code: 404 });
      return row;
    },
    writer: {
      async createRow({ data, permissions }) {
        writes.push({ op: "create", data, permissions });
        return { $id: `max_${++nextId}` } as never;
      },
      async updateRow() {
        throw new Error("reference maxes are append-only");
      },
      async deleteRow({ rowId }) {
        writes.push({ op: "delete", data: { rowId } });
        const at = maxes.findIndex((m) => m.$id === rowId);
        if (at >= 0) maxes.splice(at, 1);
        return {} as never;
      },
    },
  };

  const deps = { newId: () => `max_${nextId + 1}`, now: () => new Date("2026-09-15T10:00:00.000Z") };
  return { tables, writes, maxes, deps };
}

const input = (over: Record<string, unknown> = {}) => ({
  athleteId: ATHLETE,
  exerciseId: EXERCISE,
  kind: "training" as const,
  valueKg: 180,
  ...over,
});

describe("who may set a max", () => {
  it("lets an athlete set their own", async () => {
    const { tables } = harness({ links: [] });
    expect(await mayWriteFor(tables, DB, ATHLETE, ATHLETE)).toBe(true);
  });

  it("lets an actively linked coach set their athlete's", async () => {
    const { tables } = harness();
    expect(await mayWriteFor(tables, DB, COACH, ATHLETE)).toBe(true);
  });

  it("refuses a coach who is not linked to them", async () => {
    const { tables } = harness();
    expect(await mayWriteFor(tables, DB, STRANGER, ATHLETE)).toBe(false);
  });

  /**
   * The link row is the source of truth for who coaches whom -- checked here
   * rather than circle membership, so a membership left behind by a half-
   * failed revoke is never mistaken for an authorisation.
   */
  it("refuses a coach whose link was revoked", async () => {
    const { tables } = harness({
      links: [{ ...activeLink(COACH, ATHLETE), status: "revoked" }],
    });
    expect(await mayWriteFor(tables, DB, COACH, ATHLETE)).toBe(false);
  });

  it("refuses an empty caller or athlete", async () => {
    const { tables } = harness();
    expect(await mayWriteFor(tables, DB, "", ATHLETE)).toBe(false);
    expect(await mayWriteFor(tables, DB, COACH, "")).toBe(false);
  });
});

describe("setting a max", () => {
  it("writes the row and records who decided the number", async () => {
    const { tables, writes, deps } = harness();
    const result = await setReferenceMax(tables, DB, COACH, input(), deps);

    expect(result).toMatchObject({ status: "created" });
    expect(writes[0].data).toMatchObject({
      athlete_id: ATHLETE,
      exercise_id: EXERCISE,
      kind: "training",
      value_kg: 180,
      // The coach, not the athlete it is about.
      recorded_by: COACH,
    });
  });

  it("stamps the athlete's circle, never the coach by name", async () => {
    const { tables, writes, deps } = harness();
    await setReferenceMax(tables, DB, COACH, input(), deps);
    const permissions = (writes[0].permissions ?? []).join(" ");
    expect(permissions).toContain(`team:${circleTeamId(ATHLETE)}`);
    expect(permissions).not.toContain(COACH);
  });

  /** The forgery this table's whole write path exists to prevent. */
  it("writes nothing when the caller does not coach the athlete", async () => {
    const { tables, writes, deps } = harness();
    const result = await setReferenceMax(tables, DB, STRANGER, input(), deps);
    expect(result).toEqual({ status: "not-allowed" });
    expect(writes).toHaveLength(0);
  });

  it("defaults the effective date to now, and keeps a given one", async () => {
    const { tables, writes, deps } = harness();
    await setReferenceMax(tables, DB, COACH, input(), deps);
    expect(writes[0].data.effective_from).toBe("2026-09-15T10:00:00.000Z");

    // A coach entering Monday's test on Wednesday means Monday.
    await setReferenceMax(
      tables,
      DB,
      COACH,
      input({ effectiveFrom: "2026-09-13T00:00:00.000Z" }),
      deps,
    );
    expect(writes[1].data.effective_from).toBe("2026-09-13T00:00:00.000Z");
    expect(writes[1].data.created_at).toBe("2026-09-15T10:00:00.000Z");
  });

  it("rejects a number that cannot be a max", async () => {
    const { tables, writes, deps } = harness();
    for (const valueKg of [0, -5, Number.NaN]) {
      expect(await setReferenceMax(tables, DB, COACH, input({ valueKg }), deps)).toMatchObject({
        status: "invalid",
      });
    }
    expect(writes).toHaveLength(0);
  });

  it("rejects a typo dressed as a world record", async () => {
    // 1800 for 180 is the realistic slip, and it would silently re-price every
    // percentage in the block.
    const { tables, deps } = harness();
    expect(await setReferenceMax(tables, DB, COACH, input({ valueKg: 1800 }), deps)).toMatchObject({
      status: "invalid",
    });
  });

  it("rejects an unreadable date rather than defaulting to now", async () => {
    const { tables, writes, deps } = harness();
    expect(
      await setReferenceMax(tables, DB, COACH, input({ effectiveFrom: "not a date" }), deps),
    ).toMatchObject({ status: "invalid" });
    expect(writes).toHaveLength(0);
  });

  it("rejects a max with no exercise", async () => {
    const { tables, deps } = harness();
    expect(await setReferenceMax(tables, DB, COACH, input({ exerciseId: "" }), deps)).toMatchObject({
      status: "invalid",
    });
  });
});

describe("removing a max", () => {
  const existing = (): Row => ({
    $id: "max_1",
    athlete_id: ATHLETE,
    exercise_id: EXERCISE,
    kind: "training",
    value_kg: 180,
  });

  it("removes the coach's own typo", async () => {
    const { tables, maxes } = harness({ maxes: [existing()] });
    expect(await removeReferenceMax(tables, DB, COACH, "max_1")).toEqual({ status: "removed" });
    expect(maxes).toHaveLength(0);
  });

  /**
   * Whose row it is comes from the row, not from the caller. Trusting a
   * caller's claim would make every max deletable by anyone who knows an id.
   */
  it("refuses a stranger, and leaves the row alone", async () => {
    const { tables, maxes } = harness({ maxes: [existing()] });
    expect(await removeReferenceMax(tables, DB, STRANGER, "max_1")).toEqual({
      status: "not-allowed",
    });
    expect(maxes).toHaveLength(1);
  });

  it("says a missing row is gone rather than failing", async () => {
    const { tables } = harness();
    expect(await removeReferenceMax(tables, DB, COACH, "nope")).toEqual({ status: "gone" });
  });
});
