import { circleTeamId } from "@/appwrite/documents/circle";
import { profilePermissions, reviewPermissions, sessionPermissions, setPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { buildRoster, UNNAMED_ATHLETE } from "./roster";
import { fetchRoster } from "./roster-store";

/**
 * The Roster's reads, end to end through a fake Appwrite that applies the
 * queries, then through buildRoster -- because what a coach sees is the pair,
 * and the "Unnamed athlete" bug lived in the seam between them.
 */

const db = vi.hoisted(() => ({ current: null as FakeTables | null }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", tables: db.current! }),
}));

/** Teams the coach is a member of. Anything else 401s, as Appwrite does. */
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

// Wednesday. The London week began Monday 5 October.
const NOW = new Date("2026-10-07T12:00:00.000Z");

const profile = (userId: string, name: string): FakeRow => ({
  $id: userId,
  $permissions: profilePermissions({ athleteId: userId }),
  user_id: userId,
  display_name: name,
});

const session = (id: string, athleteId: string, startedAt: string, finishedAt: string | null): FakeRow => ({
  $id: id,
  $permissions: sessionPermissions({ athleteId }),
  athlete_id: athleteId,
  started_at: startedAt,
  finished_at: finishedAt,
});

async function roster(athleteIds: string[]) {
  const inputs = await fetchRoster("ruairi", athleteIds, NOW);
  const links = athleteIds.map((athleteId) => ({ athleteId, linkedAt: null }));
  return buildRoster({ ...inputs, links }, NOW).rows;
}

beforeEach(() => {
  db.current = new FakeTables();
  circles.member = new Set([circleTeamId("joey"), circleTeamId("anon")]);
});

describe("fetchRoster", () => {
  it("names an athlete from their profile, and lists one with no profile as unnamed", async () => {
    // "anon" first: a lookup that paired names to ids by position would hand
    // anon Joey's name, which is worse than no name at all.
    db.current!.seed("profiles", [profile("joey", "Joey Pang"), profile("stranger", "Not Linked")]);

    const rows = await roster(["anon", "joey"]);

    expect(rows.map((r) => [r.athleteId, r.name])).toEqual([
      ["anon", UNNAMED_ATHLETE],
      ["joey", "Joey Pang"],
    ]);
  });

  it("ignores a profile someone else wrote under the athlete's id", async () => {
    const forged = { ...profile("joey", "Hacked"), $permissions: ['read("users")'] };
    db.current!.seed("profiles", [forged]);

    const [row] = await roster(["joey"]);
    expect(row.name).toBe(UNNAMED_ATHLETE);
  });

  it("counts only finished sessions as completed this week", async () => {
    db.current!.seed("sessions", [
      session("s1", "joey", "2026-10-05T18:00:00.000Z", "2026-10-05T19:30:00.000Z"),
      // Started today and still open: in progress, not done.
      session("s2", "joey", "2026-10-07T11:00:00.000Z", null),
      // Last week's, finished. Outside the window.
      session("s0", "joey", "2026-09-29T18:00:00.000Z", "2026-09-29T19:00:00.000Z"),
      // Another athlete's, finished this week.
      session("s3", "anon", "2026-10-06T18:00:00.000Z", "2026-10-06T19:00:00.000Z"),
    ]);

    const rows = await roster(["joey"]);
    expect(rows[0].sessionsThisWeek).toBe(1);
  });

  it("marks an athlete whose circle the coach has left as not visible", async () => {
    circles.member.delete(circleTeamId("anon"));
    const rows = await roster(["anon", "joey"]);
    expect(rows.map((r) => [r.athleteId, r.visible])).toEqual([
      ["anon", false],
      ["joey", true],
    ]);
  });

  it("counts waiting clips only for this coach's athletes and not ones this coach cleared", async () => {
    const clip = (id: string, athleteId: string): FakeRow => ({
      $id: id,
      $permissions: setPermissions({ athleteId }),
      athlete_id: athleteId,
      exercise_id: "squat",
      session_id: "s1",
      logged_at: "2026-10-06T18:00:00.000Z",
      video_file_id: `file-${id}`,
    });
    db.current!.seed("sets", [clip("c1", "joey"), clip("c2", "joey"), clip("c3", "stranger")]);
    db.current!.seed("set_reviews", [
      {
        $id: "r1",
        $permissions: reviewPermissions({ athleteId: "joey", coachId: "ruairi" }),
        coach_id: "ruairi",
        athlete_id: "joey",
        set_id: "c1",
      },
    ]);

    const rows = await roster(["joey"]);
    expect(rows[0].videosWaiting).toBe(1);
  });
});
