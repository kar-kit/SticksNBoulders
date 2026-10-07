import { fetchExerciseLibrary } from "./library";

type Row = { $id: string } & Record<string, unknown>;

interface ParsedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

/**
 * An in-memory Appwrite that applies the queries the library sends: equal,
 * or-of-equals, orderAsc("$id"), cursorAfter and limit. The rows it holds are
 * everything the session could READ -- a coach can read their athletes' own
 * exercises -- so only the query decides what reaches the typeahead.
 */
const db = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(row: Row, q: ParsedQuery): boolean {
  if (q.method === "equal") return q.values!.includes(row[q.attribute!]);
  if (q.method === "or") return (q.values as ParsedQuery[]).some((inner) => matches(row, inner));
  return true;
}

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: {
      listRows: async ({ queries = [] }: { tableId: string; queries?: string[] }) => {
        const parsed = queries.map((q) => JSON.parse(q) as ParsedQuery);
        let rows = [...db.rows].sort((a, b) => a.$id.localeCompare(b.$id));
        rows = rows.filter((row) => parsed.every((q) => matches(row, q)));
        const cursor = parsed.find((q) => q.method === "cursorAfter")?.values?.[0];
        if (cursor) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
        const limit = Number(parsed.find((q) => q.method === "limit")?.values?.[0] ?? 25);
        return { rows: rows.slice(0, limit) };
      },
    },
  }),
}));
// Provenance is tested in appwrite/documents; this file is about the query and the mapping.
vi.mock("@/appwrite/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/appwrite/documents")>()),
  authenticRows: (_table: string, rows: unknown[]) => rows,
}));
vi.mock("@/lib/offline/client", () => ({ enqueue: vi.fn() }));

const row = (id: string, over: Record<string, unknown> = {}): Row => ({
  $id: id,
  name: id,
  normalised_name: id.toLowerCase(),
  is_global: true,
  owner_id: null,
  ...over,
});

beforeEach(() => {
  db.rows = [];
});

describe("loading the library", () => {
  it("reads a null or missing video default as false, and only true as true", async () => {
    db.rows = [
      row("Squat", { video_default: true }),
      row("Leg Curl", { video_default: null }),
      row("Plank"),
      row("Dip", { video_default: false }),
    ];

    const library = await fetchExerciseLibrary("joey");

    expect(library.map((e) => [e.name, e.videoDefault]).sort()).toEqual([
      ["Dip", false],
      ["Leg Curl", false],
      ["Plank", false],
      ["Squat", true],
    ]);
  });

  /**
   * The shared library plus the caller's own additions, and nobody else's: a
   * coach can read an athlete's custom lift, but it does not belong in the
   * coach's own typeahead -- and an athlete must never lose their own.
   */
  it("returns the shared library and the caller's own exercises, not another athlete's", async () => {
    db.rows = [
      row("Squat"),
      row("Joey Tempo Squat", { is_global: false, owner_id: "joey" }),
      row("Sam Pin Press", { is_global: false, owner_id: "sam" }),
    ];

    expect((await fetchExerciseLibrary("joey")).map((e) => e.name).sort()).toEqual(["Joey Tempo Squat", "Squat"]);
    expect((await fetchExerciseLibrary("ruairi")).map((e) => e.name)).toEqual(["Squat"]);
  });

  it("pages past the first hundred", async () => {
    db.rows = Array.from({ length: 230 }, (_, i) => row(`Lift ${String(i).padStart(3, "0")}`));
    db.rows.push(row("zz Joey's Last", { is_global: false, owner_id: "joey" }));
    const library = await fetchExerciseLibrary("joey");
    expect(library).toHaveLength(231);
    expect(library.at(-1)?.name).toBe("zz Joey's Last");
  });
});
