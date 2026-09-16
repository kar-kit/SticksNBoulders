import { circleTeamId } from "./circle";
import {
  bodyweightPermissions,
  exercisePermissions,
  invitePermissions,
  linkPermissions,
  POLICIES,
  profilePermissions,
  commentPermissions,
  referenceMaxPermissions,
  reviewPermissions,
  videoPermissions,
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
  // A weigh-in is the athlete's own record of their own body. The coach
  // reading it is the whole feature; the coach not writing it is the same rule
  // as everywhere else, because a coach who could edit a bodyweight could edit
  // a DOTS score.
  ["bodyweight_entries", bodyweightPermissions],
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

describe("a coach's record that they have watched a clip", () => {
  /**
   * The rule Order 17 learned the expensive way: Appwrite refuses a permission
   * naming a role the caller does not hold. A coach cannot grant the athlete
   * anything by name, so the row is stamped with the circle they share -- and
   * an athlete read spelled `user:<athleteId>` would 401 every review the
   * coach ever tried to write.
   */
  it("is read through the circle and never by naming the athlete", () => {
    const permissions = reviewPermissions({ athleteId: ATHLETE, coachId: COACH });
    expect(permissions).toContain(`read("team:${circle}")`);
    expect(permissions.join(" ")).not.toContain(`read("user:${ATHLETE}")`);
  });

  it("is edited and removed by the coach alone", () => {
    const permissions = reviewPermissions({ athleteId: ATHLETE, coachId: COACH });
    expect(permissions).toContain(`update("user:${COACH}")`);
    expect(permissions).toContain(`delete("user:${COACH}")`);
    // Clearing a coach's queue is not the athlete's to do.
    expect(permissions.join(" ")).not.toContain(`update("user:${ATHLETE}")`);
    expect(permissions.join(" ")).not.toContain(`delete("user:${ATHLETE}")`);
  });

  it("is never readable by everyone", () => {
    const permissions = reviewPermissions({ athleteId: ATHLETE, coachId: COACH }).join(" ");
    expect(permissions).not.toContain('"users"');
    expect(permissions).not.toContain('"any"');
    expect(permissions).not.toContain(STRANGER);
  });

  it("refuses to be stamped without both parties", () => {
    expect(() => reviewPermissions({ athleteId: "", coachId: COACH })).toThrow(/athleteId/);
    expect(() => reviewPermissions({ athleteId: ATHLETE, coachId: "" })).toThrow(/coachId/);
  });
});

describe("a comment on a set", () => {
  /**
   * Symmetric with a review, and that symmetry is load-bearing: both parties
   * are circle members, so both can stamp this, and the athlete's reply at
   * Order 34 needs no second policy.
   */
  it("is stamped the same way whichever of them wrote it", () => {
    const byCoach = commentPermissions({ athleteId: ATHLETE, authorId: COACH });
    const byAthlete = commentPermissions({ athleteId: ATHLETE, authorId: ATHLETE });
    expect(byCoach).toContain(`read("team:${circle}")`);
    expect(byAthlete).toContain(`read("team:${circle}")`);
    expect(byCoach.join(" ")).not.toContain(`read("user:${ATHLETE}")`);
  });

  it("gives edit and delete to the author and to nobody else", () => {
    // A record one side can edit is not a record. A coach must not be able to
    // withdraw an athlete's reply, nor an athlete a coach's correction.
    const byCoach = commentPermissions({ athleteId: ATHLETE, authorId: COACH });
    expect(byCoach).toContain(`update("user:${COACH}")`);
    expect(byCoach).toContain(`delete("user:${COACH}")`);
    expect(byCoach.join(" ")).not.toContain(`update("user:${ATHLETE}")`);
    expect(byCoach.join(" ")).not.toContain(`delete("user:${ATHLETE}")`);
  });

  it("reads through the circle, so revoking a link takes the thread with it", () => {
    const permissions = commentPermissions({ athleteId: ATHLETE, authorId: COACH }).join(" ");
    expect(permissions).not.toContain('"users"');
    expect(permissions).not.toContain('"any"');
    expect(permissions).not.toContain(STRANGER);
  });

  it("refuses to be stamped without both ids", () => {
    expect(() => commentPermissions({ athleteId: "", authorId: COACH })).toThrow(/athleteId/);
    expect(() => commentPermissions({ athleteId: ATHLETE, authorId: "" })).toThrow(/authorId/);
  });
});

describe("policy hygiene", () => {
  it("covers every table, so one cannot be added without a policy", () => {
    expect(Object.keys(POLICIES).sort()).toEqual([
      "bodyweight_entries",
      "coach_athlete_links",
      "exercises",
      "invite_codes",
      "profiles",
      "reference_maxes",
      "sessions",
      "set_comments",
      "set_reviews",
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

describe("a video on a set", () => {
  it("is readable by the athlete and their circle, like the set itself", () => {
    const permissions = videoPermissions({ athleteId: ATHLETE });
    expect(permissions).toContain(`read("user:${ATHLETE}")`);
    expect(permissions).toContain(`read("team:${circle}")`);
  });

  /**
   * A clip is more revealing than a row of numbers and gets no wider audience
   * than the numbers do.
   */
  it("reaches nobody outside the circle", () => {
    const permissions = videoPermissions({ athleteId: ATHLETE }).join(" ");
    expect(permissions).not.toContain(STRANGER);
    expect(permissions).not.toContain('"users"');
    expect(permissions).not.toContain('"any"');
  });

  /**
   * The athlete may delete -- removing a set should take its clip, and someone
   * who filmed something they would rather not share must be able to remove it.
   * The coach may not: a review tool whose reviewer can destroy the thing under
   * review is the wrong shape.
   */
  it("is deletable by the athlete and by nobody else", () => {
    const permissions = videoPermissions({ athleteId: ATHLETE });
    expect(permissions).toContain(`delete("user:${ATHLETE}")`);
    expect(permissions).not.toContain(`delete("team:${circle}")`);
  });

  it("refuses to be stamped without an athlete", () => {
    expect(() => videoPermissions({ athleteId: "" })).toThrow(/athleteId/);
  });
});
