import { circleTeamId } from "./circle";
import {
  POLICIES,
  SERVER_ONLY_TABLES,
  USER_WRITABLE_TABLES,
  exercisePermissions,
  writtenByServer,
  writtenByUser,
} from "./policy";
import {
  VALIDATED_TABLES,
  authenticRows,
  expectedStamp,
  isAuthentic,
  ownerProof,
  verdictFor,
} from "./provenance";

const A = "athlete_a";
const B = "athlete_b";
const C = "coach_c";

/** What every session may stamp, and what the forgeries in the finding used. */
const EVERYONE = ['read("users")'];

const stamped = (tableId: string, data: Record<string, unknown>, $id = "row") => ({
  $id,
  ...data,
  $permissions: expectedStamp(tableId, { $id, ...data })!,
});

describe("the proof of authorship", () => {
  it.each([
    ["profiles", { user_id: A }, writtenByUser(A)],
    ["exercises", { owner_id: A, is_global: false }, writtenByUser(A)],
    ["exercises", { is_global: true }, writtenByServer()],
    ["sessions", { athlete_id: A }, writtenByUser(A)],
    ["sets", { athlete_id: A }, writtenByUser(A)],
    ["bodyweight_entries", { athlete_id: A }, writtenByUser(A)],
    ["set_reviews", { athlete_id: A, coach_id: C }, writtenByUser(C)],
    ["set_comments", { athlete_id: A, author_id: C }, writtenByUser(C)],
  ])("%s: is a permission the policy stamps, so an honest write always carries it", (table, row, proof) => {
    expect(ownerProof(table, row)).toEqual([proof]);
    expect(expectedStamp(table, row)).toContain(proof);
  });

  it("is a role only the named owner holds, never one every session has", () => {
    for (const table of USER_WRITABLE_TABLES) {
      const row = { user_id: A, owner_id: A, athlete_id: A, coach_id: C, author_id: C, is_global: false };
      for (const proof of ownerProof(table, row)!) {
        expect(proof).toMatch(/^update\("user:/);
        expect(proof).not.toMatch(/"(users|any|guests)"/);
      }
    }
    // The library's proof is a team nobody is in.
    expect(ownerProof("exercises", { is_global: true })).toEqual(['update("team:library")']);
  });

  it("names the author on a comment and the coach on a review, not the athlete the row is about", () => {
    expect(ownerProof("set_comments", { athlete_id: A, author_id: C })).toEqual([writtenByUser(C)]);
    expect(ownerProof("set_reviews", { athlete_id: A, coach_id: C })).toEqual([writtenByUser(C)]);
  });

  it("is empty for a server-only table, where no session can write at all", () => {
    for (const table of SERVER_ONLY_TABLES) expect(ownerProof(table, { athlete_id: A })).toEqual([]);
  });

  it("is null for a row with no owner, and for a table it does not know", () => {
    expect(ownerProof("sets", {})).toBeNull();
    expect(ownerProof("programs", { athlete_id: A })).toBeNull();
  });
});

describe("isAuthentic", () => {
  it("trusts every row the write helper would produce", () => {
    expect(isAuthentic("profiles", stamped("profiles", { user_id: A }, A))).toBe(true);
    expect(isAuthentic("exercises", stamped("exercises", { owner_id: A, is_global: false }))).toBe(true);
    expect(isAuthentic("exercises", stamped("exercises", { is_global: true }))).toBe(true);
    expect(isAuthentic("sets", stamped("sets", { athlete_id: A }))).toBe(true);
    expect(isAuthentic("set_reviews", stamped("set_reviews", { athlete_id: A, coach_id: C }))).toBe(true);
    expect(isAuthentic("set_comments", stamped("set_comments", { athlete_id: A, author_id: C }))).toBe(true);
    expect(isAuthentic("set_comments", stamped("set_comments", { athlete_id: A, author_id: A }))).toBe(true);
  });

  describe("rejects every forgery in the finding", () => {
    it("a set under A's id with a 400kg e1RM, stamped for everyone", () => {
      expect(isAuthentic("sets", { $id: "f", athlete_id: A, e1rm_kg: 400, $permissions: EVERYONE })).toBe(false);
    });

    it("a session and a weigh-in under A's id", () => {
      expect(isAuthentic("sessions", { $id: "f", athlete_id: A, $permissions: EVERYONE })).toBe(false);
      expect(isAuthentic("bodyweight_entries", { $id: "f", athlete_id: A, $permissions: EVERYONE })).toBe(false);
    });

    it("a custom exercise with owner_id A", () => {
      expect(isAuthentic("exercises", { $id: "f", owner_id: A, is_global: false, $permissions: EVERYONE })).toBe(false);
    });

    it("a library exercise a stranger wrote, which carries the exact stamp a seeded one used to", () => {
      expect(isAuthentic("exercises", { $id: "f", is_global: true, $permissions: EVERYONE })).toBe(false);
      // The old library stamp. Seeded rows are re-stamped by exercises:seed.
      expect(exercisePermissions({ athleteId: "library", isGlobal: true })).not.toEqual(EVERYONE);
    });

    it("a comment on A's set claiming to be the coach's words", () => {
      expect(
        isAuthentic("set_comments", { $id: "f", athlete_id: A, author_id: C, $permissions: EVERYONE }),
      ).toBe(false);
    });

    it("a review claiming the coach cleared A's clip -- by a stranger, or by A with his own circle", () => {
      expect(isAuthentic("set_reviews", { $id: "f", athlete_id: A, coach_id: C, $permissions: EVERYONE })).toBe(false);
      const byAthlete = {
        $id: "f",
        athlete_id: A,
        coach_id: C,
        $permissions: [`read("team:${circleTeamId(A)}")`, writtenByUser(A), `delete("user:${A}")`],
      };
      expect(isAuthentic("set_reviews", byAthlete)).toBe(false);
    });
  });

  describe("and the two the finding had not asserted yet", () => {
    it("A's own set relabelled with B's id: A's stamp no longer proves B wrote it", () => {
      const relabelled = { ...stamped("sets", { athlete_id: A }), athlete_id: B };
      expect(isAuthentic("sets", relabelled)).toBe(false);
    });

    it("a profile squatted at a new user's id before they onboard", () => {
      expect(isAuthentic("profiles", { $id: B, user_id: B, $permissions: EVERYONE })).toBe(false);
      // Correctly stamped by A, but sitting at B's id: still a squat.
      expect(isAuthentic("profiles", { ...stamped("profiles", { user_id: A }, A), $id: B })).toBe(false);
    });
  });

  it("takes any row in a server-only table at face value", () => {
    expect(isAuthentic("stats_rollups", { $id: "r", athlete_id: A, $permissions: EVERYONE })).toBe(true);
  });

  it("trusts nothing it does not understand", () => {
    expect(isAuthentic("sets", { $id: "r", $permissions: [writtenByUser(A)] })).toBe(false);
    expect(isAuthentic("programs", { $id: "r", athlete_id: A, $permissions: [writtenByUser(A)] })).toBe(false);
    expect(isAuthentic("sets", { $id: "r", athlete_id: A, $permissions: "not an array" })).toBe(false);
    expect(isAuthentic("sets", { $id: "r", athlete_id: A })).toBe(false);
  });

  it("ignores extra permissions: a leak is the stamp scan's business, not a forgery", () => {
    const row = stamped("sets", { athlete_id: A });
    expect(isAuthentic("sets", { ...row, $permissions: [...row.$permissions, ...EVERYONE] })).toBe(true);
  });

  it("filters a page, keeping order", () => {
    const real1 = stamped("sets", { athlete_id: A }, "1");
    const forged = { $id: "2", athlete_id: A, $permissions: EVERYONE };
    const real2 = stamped("sets", { athlete_id: A }, "3");
    expect(authenticRows("sets", [real1, forged, real2]).map((r) => r.$id)).toEqual(["1", "3"]);
  });
});

describe("the validator's verdict", () => {
  it("acts only on tables a session can write, so a bug cannot reach a server-only row", () => {
    expect(VALIDATED_TABLES).toEqual(USER_WRITABLE_TABLES);
    for (const table of SERVER_ONLY_TABLES) {
      expect(verdictFor(table, { $id: "r", athlete_id: A, $permissions: EVERYONE }).action).toBe("skip");
    }
    expect(verdictFor("programs", { $id: "r", athlete_id: A, $permissions: EVERYONE }).action).toBe("skip");
  });

  it("keeps every row the write helper would produce", () => {
    expect(verdictFor("sets", stamped("sets", { athlete_id: A })).action).toBe("keep");
    expect(verdictFor("exercises", stamped("exercises", { is_global: true })).action).toBe("keep");
    expect(verdictFor("set_comments", stamped("set_comments", { athlete_id: A, author_id: A })).action).toBe("keep");
    expect(verdictFor("profiles", stamped("profiles", { user_id: A }, A)).action).toBe("keep");
  });

  it("deletes a row whose owner did not write it, and says which proof was missing", () => {
    const verdict = verdictFor("sets", { $id: "f", athlete_id: A, $permissions: EVERYONE });
    expect(verdict.action).toBe("delete");
    expect(verdict.reason).toContain(writtenByUser(A));
  });

  it("deletes a relabelled set and a squatted profile", () => {
    expect(verdictFor("sets", { ...stamped("sets", { athlete_id: A }), athlete_id: B }).action).toBe("delete");
    expect(verdictFor("profiles", { $id: B, user_id: B, $permissions: EVERYONE }).action).toBe("delete");
    expect(verdictFor("profiles", { ...stamped("profiles", { user_id: A }, A), $id: B }).action).toBe("delete");
  });

  it("keeps a row written before a policy change, as long as its owner wrote it", () => {
    // A set stamped the way an older policy did: owner proof present, circle
    // read missing. Drift for the stamp scan to report, not a forgery.
    const legacy = { $id: "old", athlete_id: A, $permissions: [`read("user:${A}")`, writtenByUser(A)] };
    expect(verdictFor("sets", legacy).action).toBe("keep");
  });

  it("never deletes a row it cannot place: no owner, no verdict", () => {
    expect(verdictFor("sets", { $id: "r", $permissions: EVERYONE }).action).toBe("skip");
    expect(verdictFor("exercises", { $id: "r", is_global: false, $permissions: EVERYONE }).action).toBe("skip");
  });

  it("agrees with isAuthentic on every writable table, so readers and the Function hide the same rows", () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ["sets", stamped("sets", { athlete_id: A })],
      ["sets", { $id: "f", athlete_id: A, $permissions: EVERYONE }],
      ["exercises", stamped("exercises", { is_global: true })],
      ["exercises", { $id: "f", is_global: true, $permissions: EVERYONE }],
      ["set_reviews", { $id: "f", athlete_id: A, coach_id: C, $permissions: EVERYONE }],
      ["profiles", { $id: B, user_id: B, $permissions: EVERYONE }],
    ];
    for (const [table, row] of rows) {
      expect(verdictFor(table, row).action === "keep", `${table} ${row.$id}`).toBe(isAuthentic(table, row));
    }
  });
});

describe("expectedStamp", () => {
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

  it("knows every policy table and nothing else", () => {
    for (const table of Object.keys(POLICIES)) expect(expectedStamp(table, {}), table).toBeNull();
    expect(expectedStamp("programs", { athlete_id: A })).toBeNull();
  });

  it("reports a row missing its owner rather than guessing", () => {
    expect(expectedStamp("sets", { athlete_id: "" })).toBeNull();
  });
});
