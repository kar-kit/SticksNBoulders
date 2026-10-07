import { fetchPrescribedDay, fetchPrescribedDayById } from "./program-store";

/**
 * A coach pulling a week back to draft while an athlete is mid-session.
 * Today stops offering the day; the session already started from it keeps its
 * targets, because the logger asks by id and the session remembers the day.
 */

const db = vi.hoisted(() => ({ rows: {} as Record<string, Array<Record<string, unknown>>> }));

vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: {
      listRows: async ({ tableId, queries }: { tableId: string; queries: string[] }) => {
        let rows = db.rows[tableId] ?? [];
        for (const raw of queries) {
          const q = JSON.parse(raw) as { method: string; attribute?: string; values?: unknown[] };
          if (q.method === "equal" && q.attribute) rows = rows.filter((r) => q.values!.includes(r[q.attribute!]));
        }
        return { rows, total: rows.length };
      },
      getRow: async ({ tableId, rowId }: { tableId: string; rowId: string }) => {
        const row = (db.rows[tableId] ?? []).find((r) => r.$id === rowId);
        if (!row) throw new Error("not found");
        return row;
      },
    },
  }),
}));

const week = (status: string) => ({
  $id: "w1",
  program_id: "p1",
  athlete_id: "joey",
  block_id: "b1",
  position: 0,
  status,
});

beforeEach(() => {
  db.rows = {
    programs: [
      {
        $id: "p1",
        coach_id: "ruairi",
        athlete_id: "joey",
        name: "Block 1",
        status: "published",
        created_at: "2026-09-20T00:00:00.000Z",
        updated_at: "2026-09-20T00:00:00.000Z",
      },
    ],
    program_weeks: [week("published")],
    program_days: [
      {
        $id: "d1",
        program_id: "p1",
        athlete_id: "joey",
        block_id: "b1",
        week_id: "w1",
        position: 0,
        scheduled_on: "2026-10-07",
      },
    ],
    prescriptions: [
      {
        $id: "l1",
        program_id: "p1",
        athlete_id: "joey",
        week_id: "w1",
        day_id: "d1",
        exercise_id: "squat",
        position: 0,
        set_count: 3,
        updated_at: "",
      },
    ],
  };
});

describe("a week pulled back to draft", () => {
  it("leaves Today once it is draft, and comes back when it is published again", async () => {
    expect((await fetchPrescribedDay("joey", "2026-10-07"))?.day.id).toBe("d1");
    db.rows.program_weeks = [week("draft")];
    expect(await fetchPrescribedDay("joey", "2026-10-07")).toBeNull();
    db.rows.program_weeks = [week("published")];
    expect((await fetchPrescribedDay("joey", "2026-10-07"))?.day.id).toBe("d1");
  });

  it("still serves a session already started from its day, lines and all", async () => {
    db.rows.program_weeks = [week("draft")];
    const day = await fetchPrescribedDayById("d1");
    expect(day?.week.status).toBe("draft");
    expect(day?.prescriptions.map((p) => p.id)).toEqual(["l1"]);
  });
});
