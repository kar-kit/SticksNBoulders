import { toCsv } from "./csv";
import { buildLogRows, exportFileName, isoDay, LOG_COLUMNS, type ExportSet } from "./training-log";

const names = new Map([
  ["sq", "Squat"],
  ["bp", "Bench Press"],
]);

let n = 0;
const set = (over: Partial<ExportSet>): ExportSet => ({
  id: `s${n++}`,
  sessionId: "a",
  exerciseId: "sq",
  setIndex: 1,
  loadKg: 100,
  reps: 5,
  rpe: null,
  isWarmup: false,
  e1rmKg: null,
  loggedAt: new Date("2026-09-14T18:00:00Z"),
  notes: null,
  ...over,
});

describe("buildLogRows", () => {
  it("writes one row per set with every column in order", () => {
    const rows = buildLogRows(
      [{ id: "a", startedAt: new Date("2026-09-14T17:30:00Z"), notes: "Good day" }],
      [set({ loadKg: 140, reps: 5, rpe: 8, e1rmKg: 168.00000000000003, notes: "fast" })],
      names,
    );
    expect(rows).toEqual([
      ["2026-09-14", 1, "Squat", 1, 140, 5, 8, false, 168, "fast", null, "Good day"],
    ]);
    expect(rows[0]).toHaveLength(LOG_COLUMNS.length);
  });

  it("numbers sessions oldest first and orders rows by session", () => {
    const rows = buildLogRows(
      [
        { id: "late", startedAt: new Date("2026-09-20T10:00:00Z"), notes: null },
        { id: "early", startedAt: new Date("2026-09-13T10:00:00Z"), notes: null },
      ],
      [set({ sessionId: "late" }), set({ sessionId: "early" })],
      names,
    );
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ["2026-09-13", 1],
      ["2026-09-20", 2],
    ]);
  });

  it("orders exercises by first touch and sets by number within a session", () => {
    const t = (min: number) => new Date(Date.UTC(2026, 8, 14, 18, min));
    const rows = buildLogRows(
      [{ id: "a", startedAt: t(0), notes: null }],
      [
        set({ exerciseId: "bp", setIndex: 1, loggedAt: t(30) }),
        set({ exerciseId: "sq", setIndex: 2, loggedAt: t(10) }),
        // Same second as the next one, as a burst of offline sets can be.
        set({ exerciseId: "sq", setIndex: 1, loggedAt: t(10) }),
        set({ exerciseId: "sq", setIndex: 3, loggedAt: t(5), isWarmup: true }),
      ],
      names,
    );
    expect(rows.map((r) => `${r[2]} ${r[3]}`)).toEqual(["Squat 1", "Squat 2", "Squat 3", "Bench Press 1"]);
  });

  it("dates a session by its start in London, not UTC", () => {
    // 23:30 UTC on Sunday is 00:30 BST on Monday.
    const rows = buildLogRows(
      [{ id: "a", startedAt: new Date("2026-09-13T23:30:00Z"), notes: null }],
      [set({ loggedAt: new Date("2026-09-14T00:10:00Z") })],
      names,
    );
    expect(rows[0][0]).toBe("2026-09-14");
  });

  it("keeps a set whose session is missing, dated by when it was logged", () => {
    const rows = buildLogRows([], [set({ sessionId: "gone", loggedAt: new Date("2026-09-01T12:00:00Z") })], names);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("2026-09-01");
    expect(rows[0][1]).toBeNull();
  });

  it("falls back to the exercise id when the name cannot be read", () => {
    const rows = buildLogRows([], [set({ exerciseId: "ex-unknown" })], names);
    expect(rows[0][2]).toBe("ex-unknown");
  });

  it("fills Prescription from the lookup when one is given", () => {
    const rows = buildLogRows([], [set({})], names, () => "75% @8");
    expect(rows[0][10]).toBe("75% @8");
  });

  it("returns no rows for an athlete with no sets", () => {
    expect(buildLogRows([{ id: "a", startedAt: new Date(), notes: null }], [], names)).toEqual([]);
  });

  it("survives the trip through the serialiser with hostile notes", () => {
    const rows = buildLogRows(
      [{ id: "a", startedAt: new Date("2026-09-14T17:30:00Z"), notes: "=cmd|' /C calc'!A0" }],
      [set({ notes: 'knee caved, "rep 4"\nfilmed it' })],
      names,
    );
    const text = toCsv(LOG_COLUMNS, rows);
    expect(text).toContain(`"knee caved, ""rep 4""\nfilmed it"`);
    expect(text).toContain(`'=cmd|' /C calc'!A0`);
    expect(text).not.toMatch(/,=cmd/);
  });
});

describe("isoDay", () => {
  it("is YYYY-MM-DD", () => {
    expect(isoDay(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("exportFileName", () => {
  const today = new Date("2026-09-27T12:00:00Z");

  it("carries the athlete's name and the date", () => {
    expect(exportFileName("Joey Pang", today)).toBe("sticksnboulders-joey-pang-2026-09-27.csv");
  });

  it("strips accents and punctuation", () => {
    expect(exportFileName("Siobhán O'Neill", today)).toBe("sticksnboulders-siobhan-o-neill-2026-09-27.csv");
  });

  it("has a sensible name when there is no name", () => {
    expect(exportFileName(null, today)).toBe("sticksnboulders-training-log-2026-09-27.csv");
    expect(exportFileName("💪", today)).toBe("sticksnboulders-training-log-2026-09-27.csv");
  });
});
