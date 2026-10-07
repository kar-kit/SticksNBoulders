import { sessionPermissions, setPermissions } from "@/appwrite/documents/policy";
import { FakeTables, type FakeRow } from "@/lib/testing/fake-tables";
import { BOM } from "./csv";
import { buildTrainingLogExport } from "./export-log";

/**
 * The assembled file: fetch, shape and serialise together, through a fake
 * Appwrite that applies the athlete filter and the column select. The pieces
 * are tested on their own; this is what catches them not being joined up --
 * which is how the Prescription column shipped blank after sets began storing
 * one.
 */

const set = (id: string, athleteId: string, over: Partial<FakeRow> = {}): FakeRow => ({
  $id: id,
  $permissions: setPermissions({ athleteId }),
  athlete_id: athleteId,
  session_id: "s1",
  exercise_id: "sq",
  set_index: 1,
  load_kg: 60,
  reps: 5,
  rpe: null,
  is_warmup: false,
  e1rm_kg: null,
  logged_at: "2026-09-14T17:35:00.000Z",
  notes: null,
  prescription_id: null,
  prescribed: null,
  ...over,
});

function fixture() {
  return new FakeTables()
    .seed("sessions", [
      {
        $id: "s1",
        $permissions: sessionPermissions({ athleteId: "ath" }),
        athlete_id: "ath",
        started_at: "2026-09-14T17:30:00.000Z",
        notes: "PB day",
      },
    ])
    .seed("sets", [
      set("w1", "ath", { is_warmup: true }),
      set("k1", "ath", {
        set_index: 2,
        load_kg: 142.5,
        reps: 3,
        rpe: 8.5,
        e1rm_kg: 155.04,
        logged_at: "2026-09-14T17:50:00.000Z",
        notes: "felt fast",
        prescription_id: "line1",
        prescribed: "3 x 142.5 kg @ RPE 8",
      }),
      // Someone else's set in the same session id. Not this athlete's file.
      set("x1", "other", { load_kg: 300, prescribed: "not yours" }),
    ])
    .seed("exercises", [{ $id: "sq", name: "Squat" }]);
}

const lines = (parts: readonly string[]) => {
  const text = parts.join("");
  expect(text.startsWith(BOM)).toBe(true);
  return text.slice(BOM.length).split("\r\n");
};

describe("buildTrainingLogExport", () => {
  it("writes the header, a warm-up, and a working set with its prescription", async () => {
    const built = await buildTrainingLogExport(fixture(), "db", { id: "ath", name: "Joey Pang" }, {
      today: new Date("2026-09-27T12:00:00Z"),
    });

    expect(lines(built.parts)).toEqual([
      "Date,Session,Exercise,Set,Load (kg),Reps,RPE,Warm-up,e1RM (kg),Notes,Prescription,Session notes",
      "2026-09-14,1,Squat,1,60,5,,Yes,,,,PB day",
      "2026-09-14,1,Squat,2,142.5,3,8.5,No,155,felt fast,3 x 142.5 kg @ RPE 8,PB day",
      "",
    ]);
    expect(built).toMatchObject({
      fileName: "sticksnboulders-joey-pang-2026-09-27.csv",
      setCount: 2,
      sessionCount: 1,
      skipped: 0,
    });
  });

  it("leaves the Prescription cell blank for a set nobody prescribed", async () => {
    const tables = new FakeTables().seed("sets", [set("f1", "ath")]);
    const built = await buildTrainingLogExport(tables, "db", { id: "ath", name: null });
    const [, row] = lines(built.parts);
    // Column 11 of 12, empty, with the session-notes cell still after it.
    expect(row.split(",")).toHaveLength(12);
    expect(row.split(",")[10]).toBe("");
  });
});
