import { fetchCoachStatus, initialsFor, NOT_A_COACH, railName } from "./role";

/**
 * coach_athlete_links as the browser sees it: every row the session may read,
 * filtered, limited and projected the way Appwrite would. A stub that returned
 * a fixed page would pass whatever query role.ts sent.
 */
const links = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "sticksnboulders",
    tables: {
      async listRows({ tableId, queries }: { tableId: string; queries: string[] }) {
        if (tableId !== "coach_athlete_links") throw new Error(`unexpected table ${tableId}`);
        const parsed = queries.map((q) => JSON.parse(q) as { method: string; attribute?: string; values?: unknown[] });
        let rows = links.rows.filter((row) =>
          parsed.every((q) => q.method !== "equal" || (q.values ?? []).includes(row[q.attribute ?? ""])),
        );
        // Appwrite pages at 25 rows when no limit is given.
        rows = rows.slice(0, Number(parsed.find((q) => q.method === "limit")?.values?.[0] ?? 25));
        const select = parsed.find((q) => q.method === "select")?.values as string[] | undefined;
        if (select) rows = rows.map((row) => Object.fromEntries(select.map((key) => [key, row[key]])));
        return { total: rows.length, rows };
      },
    },
  }),
}));

describe("initialsFor", () => {
  it.each([
    ["Joey Pang", "JP"],
    ["Ruairi Deane", "RD"],
    ["Joey", "J"],
    ["joey pang", "JP"],
    ["Mary Anne Smith", "MS"],
  ])("turns %j into %j", (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });

  it("copes with padding and double spaces", () => {
    expect(initialsFor("  Joey   Pang  ")).toBe("JP");
  });

  it("never renders an empty avatar", () => {
    // A blank square reads as a broken image.
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });
});

describe("railName", () => {
  it.each([
    ["Joey Pang", "Joey P"],
    ["Sam Tierney", "Sam T"],
    ["Alex Moran", "Alex M"],
  ])("shortens %j to %j, because the rail is 180px", (name, expected) => {
    expect(railName(name)).toBe(expected);
  });

  it("leaves a single name alone", () => {
    expect(railName("Joey")).toBe("Joey");
  });

  it("uses the last name, not the middle one", () => {
    expect(railName("Mary Anne Smith")).toBe("Mary S");
  });

  it("returns nothing for nothing, rather than a stray initial", () => {
    expect(railName("")).toBe("");
  });
});

describe("fetchCoachStatus", () => {
  const COACH = "coach_ruairi";
  const link = (athleteId: string, extra: Record<string, unknown> = {}) => ({
    $id: `link_${athleteId}`,
    coach_id: COACH,
    athlete_id: athleteId,
    status: "active",
    ...extra,
  });

  beforeEach(() => {
    links.rows = [];
  });

  it("lists the athletes actively linked to the caller", async () => {
    links.rows = [link("athlete_joey"), link("athlete_sam")];
    expect(await fetchCoachStatus(COACH)).toEqual({ isCoach: true, athleteIds: ["athlete_joey", "athlete_sam"] });
  });

  it("drops a revoked link, so an athlete who unlinked leaves the roster", async () => {
    links.rows = [link("athlete_joey"), link("athlete_sam", { status: "revoked" })];
    expect(await fetchCoachStatus(COACH)).toEqual({ isCoach: true, athleteIds: ["athlete_joey"] });
  });

  it("is not a coach when every link has been revoked", async () => {
    links.rows = [link("athlete_joey", { status: "revoked" })];
    expect(await fetchCoachStatus(COACH)).toEqual(NOT_A_COACH);
  });

  it("counts only links where the caller is the coach", async () => {
    // An athlete can read their own link too. Reading it as theirs to coach
    // would make every linked athlete a coach of themselves.
    links.rows = [link("athlete_joey"), link("athlete_sam", { coach_id: "coach_louis" })];
    expect(await fetchCoachStatus(COACH)).toEqual({ isCoach: true, athleteIds: ["athlete_joey"] });
    expect(await fetchCoachStatus("athlete_joey")).toEqual(NOT_A_COACH);
  });

  it("keeps a roster past Appwrite's default page of 25", async () => {
    links.rows = Array.from({ length: 40 }, (_, i) => link(`athlete_${i}`));
    expect((await fetchCoachStatus(COACH)).athleteIds).toHaveLength(40);
  });

  it("stops at 100 athletes", async () => {
    // The cap bounds one browser read; it is not pagination. A roster past it
    // is truncated without a word, so changing the number should be deliberate.
    links.rows = Array.from({ length: 120 }, (_, i) => link(`athlete_${i}`));
    expect((await fetchCoachStatus(COACH)).athleteIds).toHaveLength(100);
  });

  it("skips a row with no athlete id rather than listing a blank", async () => {
    links.rows = [link("athlete_joey"), link("")];
    expect((await fetchCoachStatus(COACH)).athleteIds).toEqual(["athlete_joey"]);
  });
});
