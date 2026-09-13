import { circleTeamId, CIRCLE_ROLES } from "./circle";
import {
  addCoachToCircle,
  ensureCircle,
  listCircleCoaches,
  removeCoachFromCircle,
  type TeamAdmin,
} from "./circle-admin";

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const OTHER = "coach_louis";

function fakeTeams(existing: string[] = []) {
  const teams = new Set(existing);
  const memberships = new Map<string, Array<{ $id: string; userId: string; roles: string[] }>>();
  const calls: string[] = [];
  let n = 0;

  const api: TeamAdmin = {
    async get({ teamId }) {
      calls.push(`get:${teamId}`);
      if (!teams.has(teamId)) throw new Error("not found");
      return { $id: teamId };
    },
    async create({ teamId, name }) {
      calls.push(`create:${teamId}:${name}`);
      teams.add(teamId);
      memberships.set(teamId, []);
      return { $id: teamId };
    },
    async createMembership({ teamId, userId, roles }) {
      calls.push(`addMember:${teamId}:${userId}:${roles.join(",")}`);
      const list = memberships.get(teamId) ?? [];
      const row = { $id: `m${++n}`, userId, roles };
      list.push(row);
      memberships.set(teamId, list);
      return row;
    },
    async listMemberships({ teamId }) {
      return { memberships: memberships.get(teamId) ?? [] };
    },
    async deleteMembership({ teamId, membershipId }) {
      calls.push(`removeMember:${teamId}:${membershipId}`);
      memberships.set(teamId, (memberships.get(teamId) ?? []).filter((m) => m.$id !== membershipId));
      return {};
    },
  };

  return { api, calls, memberships, teams };
}

describe("ensureCircle", () => {
  it("creates the circle and puts the athlete in it", async () => {
    const f = fakeTeams();
    const teamId = await ensureCircle(f.api, ATHLETE, "Joey Pang");
    expect(teamId).toBe(circleTeamId(ATHLETE));
    expect(f.calls).toContain(`create:${teamId}:Joey Pang — circle`);
    expect(f.memberships.get(teamId)).toEqual([
      { $id: "m1", userId: ATHLETE, roles: [CIRCLE_ROLES.athlete] },
    ]);
  });

  it("is idempotent, so onboarding can call it again safely", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    f.calls.length = 0;
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    expect(f.calls.filter((c) => c.startsWith("create:"))).toEqual([]);
    expect(f.calls.filter((c) => c.startsWith("addMember:"))).toEqual([]);
  });

  it("repairs a circle whose athlete membership went missing", async () => {
    // An athlete with no membership has no access to their own history. Fixing
    // it quietly beats failing at the moment they open the app.
    const f = fakeTeams([circleTeamId(ATHLETE)]);
    f.memberships.set(circleTeamId(ATHLETE), []);
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    expect(f.memberships.get(circleTeamId(ATHLETE))).toHaveLength(1);
  });
});

describe("adding a coach", () => {
  it("adds them as a coach, which grants retroactive read", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    await addCoachToCircle(f.api, ATHLETE, COACH);
    expect(await listCircleCoaches(f.api, ATHLETE)).toEqual([COACH]);
  });

  it("does not duplicate an existing membership", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    await addCoachToCircle(f.api, ATHLETE, COACH);
    await addCoachToCircle(f.api, ATHLETE, COACH);
    expect(await listCircleCoaches(f.api, ATHLETE)).toEqual([COACH]);
  });

  it("supports more than one coach, which Ruairi and Louis both being at Uxbridge needs", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    await addCoachToCircle(f.api, ATHLETE, COACH);
    await addCoachToCircle(f.api, ATHLETE, OTHER);
    expect((await listCircleCoaches(f.api, ATHLETE)).sort()).toEqual([OTHER, COACH].sort());
  });

  it("refuses to make an athlete their own coach", async () => {
    const f = fakeTeams();
    await expect(addCoachToCircle(f.api, ATHLETE, ATHLETE)).rejects.toThrow(/own coach/);
  });

  it("does not list the athlete as one of their own coaches", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    expect(await listCircleCoaches(f.api, ATHLETE)).toEqual([]);
  });
});

describe("removing a coach", () => {
  it("revokes access to every row at once", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    await addCoachToCircle(f.api, ATHLETE, COACH);
    await removeCoachFromCircle(f.api, ATHLETE, COACH);
    expect(await listCircleCoaches(f.api, ATHLETE)).toEqual([]);
  });

  it("leaves the athlete's own membership alone", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    await addCoachToCircle(f.api, ATHLETE, COACH);
    await removeCoachFromCircle(f.api, ATHLETE, COACH);
    expect(f.memberships.get(circleTeamId(ATHLETE))).toEqual([
      { $id: "m1", userId: ATHLETE, roles: [CIRCLE_ROLES.athlete] },
    ]);
  });

  it("refuses to remove the athlete from their own circle", async () => {
    // That would lock them out of their entire training history.
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    await expect(removeCoachFromCircle(f.api, ATHLETE, ATHLETE)).rejects.toThrow(/refusing/);
  });

  it("leaves one coach in place when another is removed", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    await addCoachToCircle(f.api, ATHLETE, COACH);
    await addCoachToCircle(f.api, ATHLETE, OTHER);
    await removeCoachFromCircle(f.api, ATHLETE, COACH);
    expect(await listCircleCoaches(f.api, ATHLETE)).toEqual([OTHER]);
  });

  it("is a no-op for a coach who was never a member", async () => {
    const f = fakeTeams();
    await ensureCircle(f.api, ATHLETE, "Joey Pang");
    f.calls.length = 0;
    await removeCoachFromCircle(f.api, ATHLETE, COACH);
    expect(f.calls.filter((c) => c.startsWith("removeMember:"))).toEqual([]);
  });
});
