import { circleTeamId } from "@/appwrite/documents/circle";
import { linkPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { canSeeCircle, fetchCoachLinks } from "./coach-links-store";
import { athleteLinkState } from "./link-status";

/**
 * The read that decides who a coach counts as linked. Through a fake Appwrite
 * that applies the coach filter and the column select, then through
 * athleteLinkState, because "linked" is the pair's answer, not either's.
 */

const db = vi.hoisted(() => ({ current: null as FakeTables | null }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", tables: db.current!, client: {} }),
}));

const circles = vi.hoisted(() => ({ member: new Set<string>() }));
vi.mock("appwrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("appwrite")>();
  class Teams {
    async get({ teamId }: { teamId: string }) {
      if (!circles.member.has(teamId)) throw new Error("401 user_unauthorized");
      return { $id: teamId };
    }
  }
  return { ...actual, Teams };
});

const link = (athleteId: string, over: Partial<FakeRow> = {}): FakeRow => ({
  $id: `link-${athleteId}`,
  $permissions: linkPermissions({ coachId: "ruairi", athleteId }),
  coach_id: "ruairi",
  athlete_id: athleteId,
  status: "active",
  linked_at: "2026-09-01T10:00:00.000Z",
  revoked_at: null,
  ...over,
});

beforeEach(() => {
  db.current = new FakeTables();
  circles.member = new Set();
});

describe("fetchCoachLinks", () => {
  it("counts only an explicitly active link as linked", async () => {
    db.current!.seed("coach_athlete_links", [
      link("joey"),
      link("left", { status: "revoked", revoked_at: "2026-10-01T09:00:00.000Z" }),
      // A status this build has never heard of -- a future "paused", a typo,
      // a half-written row. Less access is the safe guess.
      link("paused", { status: "paused" }),
      link("blank", { status: null }),
    ]);

    const records = await fetchCoachLinks("ruairi");
    const state = (id: string) => athleteLinkState(id, records).kind;

    expect(state("joey")).toBe("linked");
    expect(state("left")).toBe("left");
    expect(state("paused")).not.toBe("linked");
    expect(state("blank")).not.toBe("linked");
  });

  it("keeps when a link ended and began", async () => {
    db.current!.seed("coach_athlete_links", [link("left", { status: "revoked", revoked_at: "2026-10-01T09:00:00.000Z" })]);
    expect(await fetchCoachLinks("ruairi")).toEqual([
      { athleteId: "left", status: "revoked", revokedAt: "2026-10-01T09:00:00.000Z", linkedAt: "2026-09-01T10:00:00.000Z" },
    ]);
  });

  it("is this coach's links only", async () => {
    db.current!.seed("coach_athlete_links", [
      link("joey"),
      { ...link("brandon"), $id: "link-other", coach_id: "louis", $permissions: linkPermissions({ coachId: "louis", athleteId: "brandon" }) },
    ]);
    expect((await fetchCoachLinks("ruairi")).map((r) => r.athleteId)).toEqual(["joey"]);
  });
});

describe("canSeeCircle", () => {
  it("is true only when the coach can read the athlete's circle team", async () => {
    circles.member.add(circleTeamId("joey"));
    expect(await canSeeCircle("joey")).toBe(true);
    expect(await canSeeCircle("left")).toBe(false);
  });
});
