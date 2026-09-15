import { circleTeamId } from "./circle";
import {
  exercisePermissions,
  invitePermissions,
  linkPermissions,
  POLICIES,
  profilePermissions,
  referenceMaxPermissions,
  rollupPermissions,
  sessionPermissions,
  setPermissions,
  SERVER_ONLY_TABLES,
  USER_WRITABLE_TABLES,
} from "./policy";

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const STRANGER = "athlete_sam";
const circle = circleTeamId(ATHLETE);

/** Every athlete-owned table shares one policy. Proving it once per table. */
const OWNED = [
  ["profiles", profilePermissions],
  ["sessions", sessionPermissions],
  ["sets", setPermissions],
  ["stats_rollups", rollupPermissions],
] as const;

describe("who can read an athlete's rows", () => {
  it.each(OWNED)("%s: the athlete reads their own", (_table, policy) => {
    expect(policy({ athleteId: ATHLETE })).toContain(`read("user:${ATHLETE}")`);
  });

  it.each(OWNED)("%s: the athlete's circle reads it, which is how a coach gets access", (_t, policy) => {
    expect(policy({ athleteId: ATHLETE })).toContain(`read("team:${circle}")`);
  });

  it.each(OWNED)("%s: nobody else is named at all", (_table, policy) => {
    const permissions = policy({ athleteId: ATHLETE }).join(" ");
    expect(permissions).not.toContain(STRANGER);
    expect(permissions).not.toContain(COACH);
    // An unlinked coach is not absent by being excluded -- they are absent
    // because access comes from circle membership, which they do not have.
    expect(permissions).not.toContain('read("users")');
    expect(permissions).not.toContain('read("any")');
  });

  it.each(OWNED)("%s: never grants a blanket or guest read", (_table, policy) => {
    for (const permission of policy({ athleteId: ATHLETE })) {
      expect(permission).not.toMatch(/"(any|guests)"/);
    }
  });

  it("gives two different athletes two different circles", () => {
    expect(setPermissions({ athleteId: ATHLETE })).not.toEqual(setPermissions({ athleteId: STRANGER }));
    expect(circleTeamId(ATHLETE)).not.toBe(circleTeamId(STRANGER));
  });
});

describe("who can write an athlete's rows", () => {
  it.each([
    ["profiles", profilePermissions],
    ["sessions", sessionPermissions],
    ["sets", setPermissions],
  ] as const)("%s: the athlete may update and delete their own", (_table, policy) => {
    const permissions = policy({ athleteId: ATHLETE });
    expect(permissions).toContain(`update("user:${ATHLETE}")`);
    expect(permissions).toContain(`delete("user:${ATHLETE}")`);
  });

  it("never lets the circle write, so a coach cannot rewrite logged work", () => {
    // Constraint 5: a coach editing a block mid-way never rewrites what an
    // athlete already did. The circle grants read and only read.
    for (const [, policy] of OWNED) {
      const writes = policy({ athleteId: ATHLETE }).filter((p) => !p.startsWith("read("));
      expect(writes.every((p) => p.includes(`user:${ATHLETE}`))).toBe(true);
      expect(writes.some((p) => p.includes("team:"))).toBe(false);
    }
  });

  it("lets nobody write a rollup, not even the athlete", () => {
    // A forged rollup is a forged PR. Only the Function writes these, with an
    // API key that bypasses permissions entirely.
    expect(rollupPermissions({ athleteId: ATHLETE })).toEqual([
      `read("user:${ATHLETE}")`,
      `read("team:${circle}")`,
    ]);
  });
});

describe("exercises", () => {
  it("makes the shared library readable by anyone signed in", () => {
    expect(exercisePermissions({ athleteId: ATHLETE, isGlobal: true })).toEqual(['read("users")']);
  });

  it("lets nobody edit the shared library", () => {
    const permissions = exercisePermissions({ athleteId: ATHLETE, isGlobal: true });
    expect(permissions.some((p) => p.startsWith("update(") || p.startsWith("delete("))).toBe(false);
  });

  it("keeps an exercise typed mid-session private to its author and their coaches", () => {
    const permissions = exercisePermissions({ athleteId: ATHLETE, isGlobal: false });
    expect(permissions).toContain(`read("user:${ATHLETE}")`);
    expect(permissions).toContain(`read("team:${circle}")`);
    expect(permissions).not.toContain('read("users")');
    expect(permissions).toContain(`update("user:${ATHLETE}")`);
  });
});

describe("coach links", () => {
  it("lets both parties see the link", () => {
    const permissions = linkPermissions({ coachId: COACH, athleteId: ATHLETE });
    expect(permissions).toContain(`read("user:${ATHLETE}")`);
    expect(permissions).toContain(`read("user:${COACH}")`);
  });

  it("lets neither party write it", () => {
    // Redemption runs in a Function. Otherwise an athlete could grant
    // themselves a coach, or grant themselves AS coach to someone else.
    const permissions = linkPermissions({ coachId: COACH, athleteId: ATHLETE });
    expect(permissions.every((p) => p.startsWith("read("))).toBe(true);
  });

  it("is not circle-based, because the link is about one specific pair", () => {
    expect(linkPermissions({ coachId: COACH, athleteId: ATHLETE }).join(" ")).not.toContain("team:");
  });
});

describe("an invite code", () => {
  it("is readable by the coach it belongs to", () => {
    expect(invitePermissions({ coachId: COACH })).toEqual([`read("user:${COACH}")`]);
  });

  it("is readable by nobody else, not even the athlete about to redeem it", () => {
    // A signed-in user who could list this table could link themselves to
    // every coach on the instance. Redemption reads it with the API key.
    const permissions = invitePermissions({ coachId: COACH }).join(" ");
    expect(permissions).not.toContain(ATHLETE);
    expect(permissions).not.toContain(STRANGER);
    expect(permissions).not.toContain('"users"');
  });

  it("is writable by nobody, including the coach", () => {
    const permissions = invitePermissions({ coachId: COACH }).join(" ");
    expect(permissions).not.toContain("update(");
    expect(permissions).not.toContain("delete(");
  });

  it("refuses to be stamped without a coach", () => {
    expect(() => invitePermissions({ coachId: "" })).toThrow(/coachId/);
  });
});

describe("a reference max", () => {
  it("is readable by the athlete and their circle", () => {
    const permissions = referenceMaxPermissions({ athleteId: ATHLETE });
    expect(permissions).toContain(`read("user:${ATHLETE}")`);
    expect(permissions).toContain(`read("team:${circle}")`);
  });

  /**
   * The coach authors this table, and still cannot write it from a browser.
   * Appwrite constrains who reads a row, not what the row says: `athlete_id`
   * is data, so a client able to create one could create it carrying somebody
   * else's id and stamp it with a role everybody holds. The forged number
   * would then be what that athlete's percentages resolve against.
   */
  it("is writable by nobody, coach and athlete included", () => {
    const permissions = referenceMaxPermissions({ athleteId: ATHLETE }).join(" ");
    expect(permissions).not.toContain("update(");
    expect(permissions).not.toContain("delete(");
    expect(permissions).not.toContain("create(");
  });

  it("is stamped exactly like a rollup, which is written the same way", () => {
    expect(referenceMaxPermissions({ athleteId: ATHLETE })).toEqual(
      rollupPermissions({ athleteId: ATHLETE }),
    );
  });

  /**
   * Free from the circle design: revoking a link removes circle membership, so
   * a former coach loses sight of these without anything re-stamping the rows.
   */
  it("names no coach directly, so revoking a link removes their access", () => {
    const permissions = referenceMaxPermissions({ athleteId: ATHLETE }).join(" ");
    expect(permissions).not.toContain(COACH);
    expect(permissions).not.toContain(STRANGER);
    expect(permissions).not.toContain('"users"');
  });

  it("refuses to be stamped without an athlete", () => {
    expect(() => referenceMaxPermissions({ athleteId: "" })).toThrow(/athleteId/);
  });
});

describe("policy hygiene", () => {
  it("covers every table, so one cannot be added without a policy", () => {
    expect(Object.keys(POLICIES).sort()).toEqual([
      "coach_athlete_links",
      "exercises",
      "invite_codes",
      "profiles",
      "reference_maxes",
      "sessions",
      "sets",
      "stats_rollups",
    ]);
    expect([...USER_WRITABLE_TABLES, ...SERVER_ONLY_TABLES].sort()).toEqual(Object.keys(POLICIES).sort());
  });

  it("emits well-formed Appwrite permission strings", () => {
    const every = [
      ...profilePermissions({ athleteId: ATHLETE }),
      ...exercisePermissions({ athleteId: ATHLETE, isGlobal: false }),
      ...exercisePermissions({ athleteId: ATHLETE, isGlobal: true }),
      ...linkPermissions({ coachId: COACH, athleteId: ATHLETE }),
      ...invitePermissions({ coachId: COACH }),
      ...referenceMaxPermissions({ athleteId: ATHLETE }),
    ];
    for (const permission of every) {
      expect(permission).toMatch(/^(read|update|delete)\("(users|user:[\w.-]+|team:[\w.-]+)"\)$/);
    }
  });

  it("never emits a duplicate permission", () => {
    for (const [, policy] of OWNED) {
      const permissions = policy({ athleteId: ATHLETE });
      expect(new Set(permissions).size).toBe(permissions.length);
    }
  });

  it.each([
    ["", "empty"],
    [undefined as unknown as string, "undefined"],
    [null as unknown as string, "null"],
  ])("refuses to stamp a row when the athlete id is %s", (athleteId) => {
    // A permission string built from a missing id is the shape that produces
    // an unreachable row, or a readable one. Fail loudly instead.
    expect(() => setPermissions({ athleteId })).toThrow(/athleteId is required/);
  });

  it("refuses a link with a missing coach id", () => {
    expect(() => linkPermissions({ coachId: "", athleteId: ATHLETE })).toThrow(/coachId is required/);
  });
});

describe("circle team ids", () => {
  it("derives deterministically from the athlete, needing no lookup", () => {
    expect(circleTeamId(ATHLETE)).toBe(circleTeamId(ATHLETE));
    expect(circleTeamId(ATHLETE)).toContain(ATHLETE);
  });

  it("stays inside Appwrite's 36-character id limit for a real user id", () => {
    // Appwrite user ids are 20 chars; "circle_" takes 7.
    expect(circleTeamId("a".repeat(20)).length).toBeLessThanOrEqual(36);
  });

  it("refuses an id that would be truncated rather than silently colliding", () => {
    expect(() => circleTeamId("x".repeat(40))).toThrow(/36-character limit/);
  });

  it("refuses an empty athlete id", () => {
    expect(() => circleTeamId("")).toThrow(/athleteId is required/);
  });
});
