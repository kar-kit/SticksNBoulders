import {
  redeemInviteCode,
  resolveInviteCode,
  revokeCoachAccess,
  type LinkTables,
} from "./link-admin";
import { circleTeamId } from "./circle";

const DB = "sticksnboulders";
const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const OTHER = "coach_louis";
const CODE = "SNB-4F7K2";

interface Row extends Record<string, unknown> {
  $id: string;
}

/** Enough of Appwrite to exercise every branch, including the failures. */
function harness(options: {
  codes?: Record<string, string>;
  links?: Row[];
  members?: Record<string, string[]>;
  teamsThrowOnAdd?: boolean;
} = {}) {
  const codes = options.codes ?? { [CODE]: COACH };
  const links: Row[] = [...(options.links ?? [])];
  const members: Record<string, string[]> = { ...(options.members ?? {}) };
  const writes: Array<{ op: string; rowId: string; data: Record<string, unknown>; permissions?: string[] }> = [];

  const tables: LinkTables = {
    async getRow({ tableId, rowId }) {
      if (tableId === "invite_codes" && codes[rowId]) return { $id: rowId, coach_id: codes[rowId] };
      throw Object.assign(new Error("not found"), { code: 404 });
    },
    async listRows() {
      return { rows: links };
    },
    writer: {
      async createRow({ rowId, data, permissions }) {
        writes.push({ op: "create", rowId, data, permissions });
        links.push({ $id: rowId, ...data } as Row);
        return {} as never;
      },
      async updateRow({ rowId, data = {}, permissions }) {
        writes.push({ op: "update", rowId, data, permissions });
        const row = links.find((l) => l.$id === rowId);
        if (row) Object.assign(row, data);
        return {} as never;
      },
      async deleteRow() {
        return {} as never;
      },
    },
    teams: {
      async get() {
        return { $id: "t" };
      },
      async create() {
        return { $id: "t" };
      },
      async createMembership({ teamId, userId, roles }) {
        if (options.teamsThrowOnAdd) throw new Error("appwrite down");
        (members[teamId] ??= []).push(userId);
        void roles;
        return { $id: "m" };
      },
      async listMemberships({ teamId }) {
        return {
          memberships: (members[teamId] ?? []).map((userId) => ({
            $id: `m_${userId}`,
            userId,
            roles: userId === ATHLETE ? ["athlete"] : ["coach"],
          })),
        };
      },
      async deleteMembership({ teamId, membershipId }) {
        // Actually removes, so the re-read in revokeCoachAccess means
        // something. A stub that returned {} would make the guard look broken
        // when it is the double that is.
        const userId = membershipId.replace(/^m_/, "");
        members[teamId] = (members[teamId] ?? []).filter((id) => id !== userId);
        return {};
      },
    },
    async userName(userId) {
      return userId === COACH ? "Ruairi Deane" : userId === OTHER ? "Louis Byrne" : "";
    },
  };

  return { tables, links, members, writes };
}

const circle = circleTeamId(ATHLETE);

describe("resolving a code without writing anything", () => {
  it("names the coach it belongs to", async () => {
    const { tables } = harness();
    expect(await resolveInviteCode(tables, DB, CODE)).toEqual({
      coachId: COACH,
      coachName: "Ruairi Deane",
    });
  });

  it("answers null for a code that does not exist", async () => {
    const { tables } = harness();
    expect(await resolveInviteCode(tables, DB, "SNB-ZZZZZ")).toBeNull();
  });

  it("writes nothing", async () => {
    const { tables, writes } = harness();
    await resolveInviteCode(tables, DB, CODE);
    expect(writes).toEqual([]);
  });
});

describe("redeeming a code", () => {
  it("records the link and then grants the access", async () => {
    const { tables, members, writes } = harness();
    const result = await redeemInviteCode(tables, DB, ATHLETE, CODE);

    expect(result).toEqual({ status: "linked", coachId: COACH, coachName: "Ruairi Deane", reactivated: false });
    expect(writes[0].data).toMatchObject({ coach_id: COACH, athlete_id: ATHLETE, status: "active" });
    expect(writes[0].permissions).toEqual([`read("user:${ATHLETE}")`, `read("user:${COACH}")`]);
    expect(members[circle]).toContain(COACH);
  });

  it("writes the row before the membership, so access never precedes its record", async () => {
    // The ordering is the whole safety property. If the membership landed
    // first and the row failed, a coach could read an athlete's training with
    // nothing recording why.
    const order: string[] = [];
    const { tables } = harness();
    const realCreate = tables.writer.createRow;
    tables.writer.createRow = async (p) => {
      order.push("row");
      return realCreate(p);
    };
    const realMember = tables.teams.createMembership;
    tables.teams.createMembership = async (p) => {
      order.push("membership");
      return realMember(p);
    };

    await redeemInviteCode(tables, DB, ATHLETE, CODE);
    // Every membership, not just the coach's: ensureCircle adds the athlete to
    // their own circle first. What matters is that no access of any kind
    // precedes the record of why it was granted.
    expect(order[0]).toBe("row");
    expect(order.filter((step) => step === "membership").length).toBeGreaterThan(0);
    expect(order.indexOf("row")).toBeLessThan(order.indexOf("membership"));
  });

  it("creates the circle first, for an athlete who has never logged anything", async () => {
    // The circle is made lazily by the first flushed write, and onboarding asks
    // for the code BEFORE any training exists -- so this is the common path,
    // not an edge case. Without it, addCoachToCircle throws team_not_found and
    // the coach silently sees nothing.
    const { tables, members } = harness();
    const created: string[] = [];
    tables.teams.get = async () => {
      throw new Error("team_not_found");
    };
    tables.teams.create = async ({ teamId }) => {
      created.push(teamId);
      return { $id: teamId };
    };

    const result = await redeemInviteCode(tables, DB, ATHLETE, CODE);
    expect(result).toMatchObject({ status: "linked" });
    expect(created).toContain(circle);
    expect(members[circle]).toContain(COACH);
  });

  it("says so when the link landed but the access did not", async () => {
    const { tables, links } = harness({ teamsThrowOnAdd: true });
    const result = await redeemInviteCode(tables, DB, ATHLETE, CODE);

    expect(result).toMatchObject({ status: "linked-not-visible", coachId: COACH });
    // The row is still there. Redeeming again repairs the membership rather
    // than starting over.
    expect(links).toHaveLength(1);
  });

  it("refuses an unknown code without touching the links", async () => {
    const { tables, writes } = harness();
    expect(await redeemInviteCode(tables, DB, ATHLETE, "SNB-ZZZZZ")).toEqual({ status: "unknown-code" });
    expect(writes).toEqual([]);
  });

  it("refuses a coach redeeming their own code", async () => {
    const { tables, writes } = harness();
    expect(await redeemInviteCode(tables, DB, COACH, CODE)).toEqual({ status: "self" });
    expect(writes).toEqual([]);
  });

  it("refuses a second coach and names the one already linked", async () => {
    const { tables, writes } = harness({
      links: [{ $id: "row_1", coach_id: OTHER, athlete_id: ATHLETE, status: "active" }],
    });
    expect(await redeemInviteCode(tables, DB, ATHLETE, CODE)).toEqual({
      status: "other-coach",
      coachId: OTHER,
      coachName: "Louis Byrne",
    });
    expect(writes).toEqual([]);
  });

  it("is a no-op when the same coach is already linked", async () => {
    const { tables, writes } = harness({
      links: [{ $id: "row_1", coach_id: COACH, athlete_id: ATHLETE, status: "active" }],
      members: { [circle]: [ATHLETE, COACH] },
    });
    expect(await redeemInviteCode(tables, DB, ATHLETE, CODE)).toEqual({
      status: "already-linked",
      coachId: COACH,
      coachName: "Ruairi Deane",
    });
    expect(writes).toEqual([]);
  });

  it("repairs a link whose membership went missing", async () => {
    // Exactly what a half-failed redemption leaves behind, and redeeming the
    // same code again is how anybody notices.
    const { tables, members } = harness({
      links: [{ $id: "row_1", coach_id: COACH, athlete_id: ATHLETE, status: "active" }],
      members: { [circle]: [ATHLETE] },
    });
    await redeemInviteCode(tables, DB, ATHLETE, CODE);
    expect(members[circle]).toContain(COACH);
  });

  it("reuses the revoked row, because the unique index forbids a second", async () => {
    const { tables, writes, links } = harness({
      links: [
        { $id: "row_1", coach_id: COACH, athlete_id: ATHLETE, status: "revoked", revoked_at: "2026-08-01T00:00:00.000Z" },
      ],
    });
    const result = await redeemInviteCode(tables, DB, ATHLETE, CODE);

    expect(result).toMatchObject({ status: "linked", reactivated: true });
    expect(writes[0].op).toBe("update");
    expect(writes[0].rowId).toBe("row_1");
    expect(links).toHaveLength(1);
  });

  it("clears the revocation date rather than leaving it beside an active status", async () => {
    // A row saying active while carrying a revoked_at is a row nobody can read
    // with confidence, and this table is what the permission model trusts.
    const { tables, links } = harness({
      links: [
        { $id: "row_1", coach_id: COACH, athlete_id: ATHLETE, status: "revoked", revoked_at: "2026-08-01T00:00:00.000Z" },
      ],
    });
    await redeemInviteCode(tables, DB, ATHLETE, CODE);
    expect(links[0].status).toBe("active");
    expect(links[0].revoked_at).toBeNull();
  });

  it("re-stamps permissions on reactivation rather than trusting the old row", async () => {
    const { tables, writes } = harness({
      links: [{ $id: "row_1", coach_id: COACH, athlete_id: ATHLETE, status: "revoked" }],
    });
    await redeemInviteCode(tables, DB, ATHLETE, CODE);
    expect(writes[0].permissions).toEqual([`read("user:${ATHLETE}")`, `read("user:${COACH}")`]);
  });

  it("refuses to redeem for nobody", async () => {
    const { tables } = harness();
    await expect(redeemInviteCode(tables, DB, "", CODE)).rejects.toThrow(/athleteId/);
  });
});

describe("withdrawing a coach's access", () => {
  const linked = () =>
    harness({
      links: [{ $id: "row_1", coach_id: COACH, athlete_id: ATHLETE, status: "active" }],
      members: { [circle]: [ATHLETE, COACH] },
    });

  it("removes the access and then records it", async () => {
    const { tables, members, writes } = linked();
    const result = await revokeCoachAccess(tables, DB, ATHLETE);

    expect(result).toEqual({ status: "unlinked", coachId: COACH });
    expect(members[circle]).not.toContain(COACH);
    expect(writes[0].data).toMatchObject({ status: "revoked" });
    expect(writes[0].data.revoked_at).toEqual(expect.any(String));
  });

  it("removes the access BEFORE writing the record", async () => {
    // The inverse of linking, serving the same invariant: never access without
    // a record of why. Revoking the row first and failing to remove the
    // membership would leave a coach reading training the record says they
    // cannot see.
    const order: string[] = [];
    const { tables } = linked();
    const realDelete = tables.teams.deleteMembership;
    tables.teams.deleteMembership = async (p) => {
      order.push("membership");
      return realDelete(p);
    };
    const realUpdate = tables.writer.updateRow;
    tables.writer.updateRow = async (p) => {
      order.push("row");
      return realUpdate(p);
    };

    await revokeCoachAccess(tables, DB, ATHLETE);
    expect(order).toEqual(["membership", "row"]);
  });

  it("leaves the athlete in their own circle", async () => {
    const { tables, members } = linked();
    await revokeCoachAccess(tables, DB, ATHLETE);
    expect(members[circle]).toContain(ATHLETE);
  });

  it("writes nothing when the membership cannot be removed", async () => {
    const { tables, writes, links } = linked();
    tables.teams.deleteMembership = async () => {
      throw new Error("appwrite down");
    };

    expect(await revokeCoachAccess(tables, DB, ATHLETE)).toEqual({
      status: "still-visible",
      coachId: COACH,
    });
    expect(writes).toEqual([]);
    expect(links[0].status).toBe("active");
  });

  it("writes nothing when the coach is somehow still in the circle afterwards", async () => {
    // removeCoachFromCircle returns silently when it finds no membership, so a
    // successful-looking call proves nothing. This is the re-read that does.
    const { tables, writes } = linked();
    tables.teams.deleteMembership = async () => ({});

    expect(await revokeCoachAccess(tables, DB, ATHLETE)).toEqual({
      status: "still-visible",
      coachId: COACH,
    });
    expect(writes).toEqual([]);
  });

  it("reports an athlete with no coach as done, not as a failure", async () => {
    const { tables, writes } = harness();
    expect(await revokeCoachAccess(tables, DB, ATHLETE)).toEqual({ status: "not-linked" });
    expect(writes).toEqual([]);
  });

  it("ignores an already-revoked link", async () => {
    const { tables } = harness({
      links: [{ $id: "row_1", coach_id: COACH, athlete_id: ATHLETE, status: "revoked" }],
    });
    expect(await revokeCoachAccess(tables, DB, ATHLETE)).toEqual({ status: "not-linked" });
  });

  it("revokes rather than deletes, so the row survives to be re-linked", async () => {
    const { tables, links } = linked();
    await revokeCoachAccess(tables, DB, ATHLETE);
    expect(links).toHaveLength(1);
    expect(links[0].$id).toBe("row_1");
  });

  it("lets the same coach be linked again afterwards, reusing the row", async () => {
    // End to end through both paths: the unique index on the pair forbids a
    // second row, so unlink-then-relink has to land back on row_1.
    const { tables, links, members } = linked();
    await revokeCoachAccess(tables, DB, ATHLETE);
    const again = await redeemInviteCode(tables, DB, ATHLETE, CODE);

    expect(again).toMatchObject({ status: "linked", reactivated: true });
    expect(links).toHaveLength(1);
    expect(links[0].status).toBe("active");
    expect(links[0].revoked_at).toBeNull();
    expect(members[circle]).toContain(COACH);
  });

  it("refuses to revoke for nobody", async () => {
    const { tables } = harness();
    await expect(revokeCoachAccess(tables, DB, "")).rejects.toThrow(/athleteId/);
  });
});
