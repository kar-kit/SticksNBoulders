import { commentPermissions, setPermissions } from "@/appwrite/documents/policy";
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

/** Stamped as the write helper would have. The store trusts nothing else. */
const coachComment = (id: string, setId: string) => ({
  $id: id,
  set_id: setId,
  athlete_id: "joey",
  author_id: "ruairi",
  body: "Brace harder.",
  created_at: "2026-09-20T10:00:00.000Z",
  $permissions: commentPermissions({ athleteId: "joey", authorId: "ruairi" }),
});
const joeySet = (id: string) => ({
  $id: id,
  athlete_id: "joey",
  session_id: "x",
  exercise_id: "squat",
  $permissions: setPermissions({ athleteId: "joey" }),
});

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
    const recent = Array.from({ length: 40 }, (_, i) => coachComment(`c${i}`, `s${i % 12}`));
    rowsFor.fn = ({ tableId }) =>
      tableId === "set_comments" ? recent : Array.from({ length: 12 }, (_, i) => joeySet(`s${i}`));

    const { comments, sets } = await fetchFeedback("joey", ["uploading"]);

    expect(calls).toHaveLength(3);
    expect(comments).toHaveLength(40);
    expect(sets.size).toBe(12);
    const setRead = calls.find((c) => c.tableId === "sets")!;
    // The uploading set rides on the same read.
    expect(setRead.queries.some((q) => q.includes("uploading"))).toBe(true);
  });

  it("drops a comment claiming to be the coach's that the coach did not stamp", async () => {
    // The forgery from the 27 Sep finding: author_id says Ruairi, the stamp
    // says anyone. Readable by all, trusted by nobody.
    const forged = { ...coachComment("f", "s1"), $permissions: ['read("users")'] };
    rowsFor.fn = ({ tableId }) =>
      tableId === "set_comments" ? [coachComment("real", "s1"), forged] : [joeySet("s1")];

    const { comments } = await fetchFeedback("joey");
    expect(comments.map((c) => c.id)).toEqual(["real"]);
  });

  it("drops a set under the athlete's id that the athlete did not write", async () => {
    rowsFor.fn = ({ tableId }) =>
      tableId === "set_comments"
        ? [coachComment("c", "s1"), coachComment("d", "forged")]
        : [joeySet("s1"), { ...joeySet("forged"), $permissions: ['read("users")'] }];

    const { sets } = await fetchFeedback("joey");
    expect([...sets.keys()]).toEqual(["s1"]);
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
    rowsFor.fn = () => [
      coachComment("a", "s1"),
      coachComment("b", "s1"),
      // A forged comment must not light the badge.
      { ...coachComment("f", "s1"), $permissions: ['read("users")'] },
    ];
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
