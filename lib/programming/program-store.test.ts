import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { fetchLoggedDayIds, fetchProgramTree, sendProgramOp } from "./program-store";

/**
 * The real read and write path behind the program editor. The editor's own
 * suites mock this module wholesale, so this is where a long program arriving
 * whole, and a server refusal reaching the screen, are proved.
 *
 * Reads run against a fake that applies limit and cursor the way Appwrite
 * does, so a store that stops after the first page comes back short here.
 */

const db = vi.hoisted(() => ({
  tables: null as (FakeTables & { getRow: (p: { tableId: string; rowId: string }) => Promise<FakeRow> }) | null,
  createJWT: vi.fn(async () => ({ jwt: "jwt-1" })),
}));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({
    databaseId: "db",
    tables: db.tables!,
    account: { createJWT: db.createJWT },
  }),
}));

function fakeTables() {
  const tables = new FakeTables() as FakeTables & {
    getRow: (p: { tableId: string; rowId: string }) => Promise<FakeRow>;
  };
  tables.getRow = async ({ tableId, rowId }) => {
    const row = tables.rows[tableId]?.find((r) => r.$id === rowId);
    if (!row) throw new Error("not found");
    return { ...row };
  };
  return tables;
}

const pad = (i: number) => String(i).padStart(3, "0");
const base = { program_id: "p1", athlete_id: "joey", coach_id: "ruairi" };

/** A 12-week block, 4 days a week, 6 lines a day: 288 prescriptions. */
function seedTwelveWeekBlock(tables: FakeTables) {
  tables.seed("programs", [
    {
      $id: "p1",
      coach_id: "ruairi",
      athlete_id: "joey",
      name: "Meet prep",
      status: "published",
      created_at: "2026-09-20T00:00:00.000Z",
      updated_at: "2026-09-20T00:00:00.000Z",
    },
  ]);
  tables.seed("program_blocks", [{ $id: "b1", ...base, position: 0, name: "Prep" }]);
  for (let w = 0; w < 12; w++) {
    const weekId = `w${pad(w)}`;
    tables.seed("program_weeks", [{ $id: weekId, ...base, block_id: "b1", position: w, status: "published" }]);
    for (let d = 0; d < 4; d++) {
      const dayId = `d${pad(w * 4 + d)}`;
      tables.seed("program_days", [
        { $id: dayId, ...base, block_id: "b1", week_id: weekId, position: d, scheduled_on: null },
      ]);
      for (let l = 0; l < 6; l++) {
        tables.seed("prescriptions", [
          {
            $id: `l${pad((w * 4 + d) * 6 + l)}`,
            ...base,
            week_id: weekId,
            day_id: dayId,
            exercise_id: "squat",
            position: l,
            set_count: 3,
            updated_at: "",
          },
        ]);
      }
    }
  }
}

beforeEach(() => {
  db.tables = fakeTables();
  db.createJWT.mockClear();
  vi.unstubAllGlobals();
});

describe("fetchProgramTree", () => {
  it("reads a 12-week block of 288 lines whole, paging past 100 rows", async () => {
    seedTwelveWeekBlock(db.tables!);

    const tree = await fetchProgramTree("p1");

    const weeks = tree!.blocks.flatMap((b) => b.weeks);
    const days = weeks.flatMap((w) => w.days);
    const lines = days.flatMap((d) => d.prescriptions);
    expect(weeks).toHaveLength(12);
    expect(days).toHaveLength(48);
    expect(lines).toHaveLength(288);
    expect(new Set(lines.map((l) => l.id)).size).toBe(288);

    // Three pages of prescriptions, each after the last row of the one before.
    const pages = db.tables!.callsTo("prescriptions");
    expect(pages).toHaveLength(3);
    const cursors = pages.map((c) => c.queries.find((q) => q.method === "cursorAfter")?.values?.[0]);
    expect(cursors).toEqual([undefined, "l099", "l199"]);
  });
});

describe("fetchLoggedDayIds", () => {
  it("finds a logged day that sits past the first 100 sessions, for this athlete only", async () => {
    const sessions: FakeRow[] = [];
    for (let i = 0; i < 300; i++) {
      sessions.push({ $id: `s${pad(i)}`, athlete_id: "joey", program_day_id: `other-${i}` });
    }
    // Page 3 by $id order.
    sessions.push({ $id: "s250x", athlete_id: "joey", program_day_id: "dX" });
    // Someone else's session on the same day id must not mark it logged.
    sessions.push({ $id: "s000a", athlete_id: "brandon", program_day_id: "dY" });
    db.tables!.seed("sessions", sessions);

    const logged = await fetchLoggedDayIds("joey", ["dX", "dY", "d-never"]);

    expect([...logged]).toEqual(["dX"]);
    expect(db.tables!.callsTo("sessions").length).toBeGreaterThanOrEqual(3);
  });
});

describe("sendProgramOp", () => {
  const respond = (status: number, body: unknown) => {
    const fetch = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body instanceof Error) throw body;
        return body;
      },
    }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  it("throws the server's error on a 403 refusal", async () => {
    const fetch = respond(403, { error: "not-allowed" });
    await expect(sendProgramOp({ op: "updateProgram", programId: "p1", name: "x" })).rejects.toThrow(
      "not-allowed",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prefers the server's reason on a 400", async () => {
    respond(400, { error: "invalid", reason: "setCount: too big" });
    await expect(sendProgramOp({ op: "updateProgram", programId: "p1", name: "x" })).rejects.toThrow(
      "setCount: too big",
    );
  });

  it("names the status when a 500 has no readable body", async () => {
    respond(500, new SyntaxError("not json"));
    await expect(sendProgramOp({ op: "updateProgram", programId: "p1", name: "x" })).rejects.toThrow(
      "program write failed: 500",
    );
  });

  it("refuses an invalid op before any request", async () => {
    const fetch = respond(200, { rowId: "r1" });
    await expect(sendProgramOp({ op: "addDay" } as never)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(db.createJWT).not.toHaveBeenCalled();
  });

  it("returns the row id on success, sent with the JWT", async () => {
    const fetch = respond(200, { rowId: "r1" });
    await expect(sendProgramOp({ op: "updateProgram", programId: "p1", name: "x" })).resolves.toEqual({
      rowId: "r1",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/program");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt-1");
  });
});
