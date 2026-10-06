import { fetchFeedback, fetchHasCoach, fetchUnreadCount } from "./feedback-store";

/**
 * The query shapes, against a fake Appwrite. The live path is e2e:feedback;
 * what this pins is the round-trip count, which is the "no N+1" promise.
 */

interface Call {
  tableId: string;
  queries: string[];
}

const calls: Call[] = [];
const rowsFor = vi.hoisted(() => ({ fn: (() => []) as (call: { tableId: string; queries: string[] }) => unknown[] }));

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: {
      listRows: async ({ tableId, queries }: { tableId: string; queries: string[] }) => {
        calls.push({ tableId, queries });
        return { rows: rowsFor.fn({ tableId, queries }), total: 0 };
      },
    },
  }),
}));

const has = (call: Call, method: string, attribute?: string) =>
  call.queries.some((q) => {
    const parsed = JSON.parse(q) as { method: string; attribute?: string };
    return parsed.method === method && (attribute === undefined || parsed.attribute === attribute);
  });

beforeEach(() => {
  calls.length = 0;
  rowsFor.fn = () => [];
});

describe("fetchFeedback", () => {
  it("costs three queries however many comments there are", async () => {
    const recent = Array.from({ length: 40 }, (_, i) => ({
      $id: `c${i}`,
      set_id: `s${i % 12}`,
      athlete_id: "joey",
      author_id: "ruairi",
      body: "Brace harder.",
      created_at: "2026-09-20T10:00:00.000Z",
    }));
    rowsFor.fn = ({ tableId }) =>
      tableId === "set_comments"
        ? recent
        : Array.from({ length: 12 }, (_, i) => ({ $id: `s${i}`, session_id: "x", exercise_id: "squat" }));

    const { comments, sets } = await fetchFeedback("joey", ["uploading"]);

    expect(calls).toHaveLength(3);
    expect(comments).toHaveLength(40);
    expect(sets.size).toBe(12);
    const setRead = calls.find((c) => c.tableId === "sets")!;
    // The uploading set rides on the same read.
    expect(setRead.queries.some((q) => q.includes("uploading"))).toBe(true);
  });

  it("stops after one query for an athlete nobody has spoken to", async () => {
    const { comments, sets } = await fetchFeedback("joey");
    expect(comments).toEqual([]);
    expect(sets.size).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe("fetchUnreadCount", () => {
  it("asks only for other people's comments after the watermark", async () => {
    rowsFor.fn = () => [{ $id: "a" }, { $id: "b" }];
    expect(await fetchUnreadCount("joey", "2026-09-20T10:00:00.000Z")).toBe(2);
    const [call] = calls;
    expect(call.tableId).toBe("set_comments");
    expect(has(call, "equal", "athlete_id")).toBe(true);
    expect(has(call, "notEqual", "author_id")).toBe(true);
    expect(has(call, "greaterThan", "created_at")).toBe(true);
  });

  it("drops the time filter when the athlete has never looked", async () => {
    await fetchUnreadCount("joey", null);
    expect(has(calls[0], "greaterThan")).toBe(false);
  });
});

describe("fetchHasCoach", () => {
  it("reads the athlete's own active link row", async () => {
    rowsFor.fn = () => [{ $id: "link" }];
    expect(await fetchHasCoach("joey")).toBe(true);
    expect(calls[0].tableId).toBe("coach_athlete_links");
    expect(has(calls[0], "equal", "status")).toBe(true);
  });
});
