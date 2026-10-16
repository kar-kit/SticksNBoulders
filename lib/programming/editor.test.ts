import {
  applyLineOp,
  cellText,
  commitCell,
  commitProgression,
  describeLoad,
  draftWeeks,
  loadPreview,
  moveCell,
  parseRepsCell,
  parseRestCell,
  parseSetsCell,
  parseShorthand,
  previewDate,
  progressionText,
  rememberedReference,
  unresolvedWarning,
  weekState,
} from "./editor";
import type { Prescription, ProgramOpInput, ProgramTree } from "./program";
import type { Exercise } from "@/lib/exercises/match";

const line = (over: Partial<Prescription> = {}): Prescription => ({
  id: "l1",
  programId: "p1",
  weekId: "w1",
  dayId: "d1",
  exerciseId: "squat",
  position: 0,
  setCount: 3,
  reps: 5,
  repMax: null,
  load: "75%",
  loadKind: "percent",
  restSeconds: 180,
  notes: null,
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("the load cell's indicator", () => {
  it.each([
    ["142.5", "fixed", "Fixed · 142.5 kg"],
    ["75%", "percent", "Percent · 75% of training max"],
    ["80% of tested", "percent", "Percent · 80% of tested max"],
    ["@8", "rpe", "RPE 8 · athlete picks the weight"],
    ["75% @8", "capped", "Capped · 75% of training max, stop at RPE 8"],
    ["work up to a heavy single", "freeform", "Freeform · shown as written"],
  ])("says %s landed as %s", (text, kind, label) => {
    expect(describeLoad(text)).toEqual({ kind, label });
  });

  it("names the two typos that look fine: a bare 8 is 8 kg, and 75%% is freeform", () => {
    expect(describeLoad("8").label).toBe("Fixed · 8 kg");
    expect(describeLoad("75%%").kind).toBe("freeform");
  });

  it("says what an empty load cell takes, rather than a bare \"No load\" that reads as a fault", () => {
    expect(describeLoad("")).toEqual({ kind: null, label: "No load yet · type 75%, @8 or 142.5" });
    expect(describeLoad(null)).toEqual({ kind: null, label: "No load yet · type 75%, @8 or 142.5" });
  });
});

describe("reading typed cells", () => {
  it("takes sets as a whole number from 1 to 50", () => {
    expect(parseSetsCell(" 4 ")).toEqual({ ok: true, value: 4 });
    for (const bad of ["0", "51", "3.5", "x", ""]) expect(parseSetsCell(bad).ok).toBe(false);
  });

  it("takes reps as a count, a range either dash, or nothing", () => {
    expect(parseRepsCell("5")).toEqual({ ok: true, value: { reps: 5, repMax: null } });
    expect(parseRepsCell("8-10")).toEqual({ ok: true, value: { reps: 8, repMax: 10 } });
    expect(parseRepsCell("8 – 10")).toEqual({ ok: true, value: { reps: 8, repMax: 10 } });
    expect(parseRepsCell("5-5")).toEqual({ ok: true, value: { reps: 5, repMax: null } });
    expect(parseRepsCell("")).toEqual({ ok: true, value: { reps: null, repMax: null } });
  });

  it("refuses a range that runs downwards, rather than guessing which number was meant", () => {
    expect(parseRepsCell("10-8").ok).toBe(false);
    expect(parseRepsCell("0").ok).toBe(false);
  });

  it("takes rest as seconds, minutes or a clock", () => {
    expect(parseRestCell("90")).toEqual({ ok: true, value: 90 });
    expect(parseRestCell("90s")).toEqual({ ok: true, value: 90 });
    expect(parseRestCell("3m")).toEqual({ ok: true, value: 180 });
    expect(parseRestCell("2:30")).toEqual({ ok: true, value: 150 });
    expect(parseRestCell("")).toEqual({ ok: true, value: null });
    expect(parseRestCell("2 hours").ok).toBe(false);
    expect(parseRestCell("61m").ok).toBe(false);
  });
});

describe("committing a cell", () => {
  it("sends only the field that changed", () => {
    expect(commitCell(line(), "load", "75% @8")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "75% @8" },
    });
    expect(commitCell(line(), "reps", "8-10")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", reps: 8, repMax: 10 },
    });
    expect(commitCell(line(), "rest", "2:00")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", restSeconds: 120 },
    });
  });

  it("writes nothing when the text did not change, so tabbing through a row is free", () => {
    for (const column of ["sets", "reps", "load", "rest", "notes"] as const) {
      expect(commitCell(line(), column, cellText(line(), column))).toEqual({ unchanged: true });
    }
  });

  it("answers a bad cell with the reason, not a write", () => {
    expect(commitCell(line(), "sets", "0")).toEqual({ error: "Sets is a whole number, 1 to 50" });
  });

  it("clears the load to nothing when emptied", () => {
    const result = commitCell(line(), "load", "");
    expect(result).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", load: "" } });
    if ("op" in result) expect(applyLineOp(line(), result.op)).toMatchObject({ load: null, loadKind: null });
  });

  it("toggles video required with a one-field write, and shows it before the server answers", () => {
    expect(cellText(line(), "video")).toBe("No");
    expect(cellText(line({ videoRequired: true }), "video")).toBe("Yes");
    const on = commitCell(line(), "video", "Yes");
    expect(on).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", videoRequired: true } });
    if ("op" in on) expect(applyLineOp(line(), on.op)).toMatchObject({ videoRequired: true, load: "75%" });
    const off = commitCell(line({ videoRequired: true }), "video", "No");
    expect(off).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", videoRequired: false } });
    expect(commitCell(line(), "video", "No")).toEqual({ unchanged: true });
  });

  it("shows the saved line before the server answers, with its kind re-derived", () => {
    const after = applyLineOp(line(), { op: "updatePrescription", prescriptionId: "l1", load: "@8", setCount: 1 });
    expect(after).toMatchObject({ load: "@8", loadKind: "rpe", setCount: 1, reps: 5, restSeconds: 180 });
    expect(applyLineOp(line(), { op: "updatePrescription", prescriptionId: "other", setCount: 9 })).toEqual(line());
  });
});

describe("moving around the grid", () => {
  const size = { rows: 3, cols: 6 };

  it("moves rows with up, down and Enter, stopping at the edges", () => {
    expect(moveCell({ row: 1, col: 2 }, "ArrowUp", size)).toEqual({ row: 0, col: 2 });
    expect(moveCell({ row: 1, col: 2 }, "ArrowDown", size)).toEqual({ row: 2, col: 2 });
    expect(moveCell({ row: 1, col: 2 }, "Enter", size)).toEqual({ row: 2, col: 2 });
    expect(moveCell({ row: 0, col: 2 }, "ArrowUp", size)).toBeNull();
    expect(moveCell({ row: 2, col: 2 }, "Enter", size)).toBeNull();
  });

  it("leaves a cell sideways only from its edge, so the caret still works inside 75% @8", () => {
    expect(moveCell({ row: 0, col: 3 }, "ArrowLeft", size, { atStart: false, atEnd: false })).toBeNull();
    expect(moveCell({ row: 0, col: 3 }, "ArrowLeft", size, { atStart: true, atEnd: false })).toEqual({ row: 0, col: 2 });
    expect(moveCell({ row: 0, col: 3 }, "ArrowRight", size, { atStart: false, atEnd: true })).toEqual({ row: 0, col: 4 });
    expect(moveCell({ row: 0, col: 5 }, "ArrowRight", size)).toBeNull();
  });

  it("leaves Tab and typing to the browser", () => {
    expect(moveCell({ row: 0, col: 0 }, "Tab", size)).toBeNull();
    expect(moveCell({ row: 0, col: 0 }, "a", size)).toBeNull();
  });
});

describe("week status", () => {
  const tree = (over: Partial<ProgramTree> = {}, days: Array<string | null>[] = [[], []]): ProgramTree => ({
    id: "p1",
    coachId: "c",
    athleteId: "a",
    name: "Block",
    status: "draft",
    startOn: null,
    notes: null,
    templateId: null,
    createdAt: "",
    updatedAt: "",
    blocks: [
      {
        id: "b1",
        programId: "p1",
        position: 0,
        name: "Volume",
        notes: null,
        weeks: days.map((dates, w) => ({
          id: `w${w + 1}`,
          programId: "p1",
          blockId: "b1",
          position: w,
          label: null,
          status: "draft" as const,
          notes: null,
          days: dates.map((scheduledOn, d) => ({
            id: `d${w}${d}`,
            programId: "p1",
            blockId: "b1",
            weekId: `w${w + 1}`,
            position: d,
            label: null,
            scheduledOn,
            notes: null,
            prescriptions: [],
          })),
        })),
      },
    ],
    ...over,
  });

  it("counts the draft weeks the Publish button is about", () => {
    expect(draftWeeks(tree())).toBe(2);
  });

  it("shows a week as live only when the week and its program are both published", () => {
    const t = tree({ status: "published" }, [["2026-10-05"]]);
    const week = t.blocks[0].weeks[0];
    expect(weekState(t, week, new Set())).toBe("draft");
    expect(weekState(t, { ...week, status: "published" }, new Set())).toBe("live");
    expect(weekState({ status: "draft" }, { ...week, status: "published" }, new Set())).toBe("draft");
  });

  it("shows a week as logged once a session was started from any of its days, and never guesses", () => {
    const t = tree({ status: "published" }, [["2026-10-05", "2026-10-06"]]);
    const week = { ...t.blocks[0].weeks[0], status: "published" as const };
    expect(weekState(t, week, new Set(["d01"]))).toBe("logged");
    expect(weekState(t, { ...week, status: "draft" }, new Set(["d01"]))).toBe("logged");
    expect(weekState(t, week, new Set(["elsewhere"]))).toBe("live");
    expect(weekState(t, week, null)).toBe("live");
  });
});

describe("a percentage of another lift (docs/reference-lift.md)", () => {
  const library: Exercise[] = [
    { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
    { id: "cgbp", name: "Close Grip Bench Press", normalisedName: "close grip bench press", isGlobal: true },
    { id: "tempo", name: "Tempo Bench", normalisedName: "tempo bench", isGlobal: false, ownerId: "joey" },
  ];
  const tempo = (over: Partial<Prescription> = {}) => line({ exerciseId: "tempo", load: "70%", ...over });

  it("strips `of <lift>` off the load into the reference, so the stored load stays 70%", () => {
    expect(commitCell(tempo({ load: null, loadKind: null }), "load", "70% of bench", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "70%", referenceExerciseId: "bench" },
    });
    // Load already 70%: only the reference is sent.
    expect(commitCell(tempo(), "load", "70% of bench", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", referenceExerciseId: "bench" },
    });
    expect(commitCell(tempo(), "load", "70% of bench @8", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "70% @8", referenceExerciseId: "bench" },
    });
    expect(commitCell(tempo(), "load", "70% of bench of tested", library)).toMatchObject({
      op: { load: "70% of tested", referenceExerciseId: "bench" },
    });
  });

  it("leaves `of tested` alone: a kind, not a lift, and the reference untouched", () => {
    expect(commitCell(tempo({ referenceExerciseId: "bench" }), "load", "70% of tested", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "70% of tested" },
    });
  });

  it("clears the reference with `of own`", () => {
    expect(commitCell(tempo({ referenceExerciseId: "bench" }), "load", "70% of own", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", referenceExerciseId: null },
    });
  });

  it("lets a lift it cannot find land as freeform, as today -- parsing never fails", () => {
    expect(commitCell(tempo(), "load", "75% of nonsense", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "75% of nonsense" },
    });
    expect(describeLoad("75% of nonsense").kind).toBe("freeform");
  });

  it("writes nothing when the typed lift is the one already set", () => {
    expect(commitCell(tempo({ referenceExerciseId: "bench" }), "load", "70% of bench press", library)).toEqual({
      unchanged: true,
    });
  });

  it("keeps the reference through a load edit, and shows it before the server answers", () => {
    const referenced = tempo({ referenceExerciseId: "bench" });
    const edited = commitCell(referenced, "load", "@8", library);
    expect(edited).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", load: "@8" } });
    expect(applyLineOp(referenced, (edited as { op: ProgramOpInput }).op).referenceExerciseId).toBe("bench");
    expect(
      applyLineOp(tempo(), { op: "updatePrescription", prescriptionId: "l1", referenceExerciseId: "bench" }).referenceExerciseId,
    ).toBe("bench");
  });

  it("says which lift the percentage is of, and only where it matters", () => {
    expect(describeLoad("70%", "Bench Press").label).toBe("Percent · 70% of Bench Press (training max)");
    expect(describeLoad("70% of tested @8", "Bench Press").label).toBe(
      "Capped · 70% of Bench Press (tested max), stop at RPE 8",
    );
    expect(describeLoad(null, "Bench Press").label).toBe("No load · a percentage here is of Bench Press");
    expect(describeLoad("@8", "Bench Press").label).toBe("RPE 8 · athlete picks the weight");
    expect(describeLoad("70%").label).toBe("Percent · 70% of training max");
  });

  describe("the warning on a percentage the athlete gets no kilos for", () => {
    const names = new Map([
      ["bench", "Bench Press"],
      ["tempo", "Tempo Bench"],
    ]);
    const max = (exerciseId: string, valueKg: number, kind: "training" | "tested" = "training") => ({
      id: `${exerciseId}-${kind}`,
      exerciseId,
      kind,
      valueKg,
      effectiveFrom: "2026-10-01T00:00:00Z",
      recordedBy: "ruairi",
    });
    const warn = (l: Prescription, entries: ReturnType<typeof max>[] | null) =>
      unresolvedWarning(l, {
        maxes: entries ? { entries, estimated: new Map() } : null,
        nameOf: (id) => names.get(id),
        athleteName: "Joey",
        asOf: new Date("2026-10-15T00:00:00Z"),
      });

    it("names the missing reference max, and ignores the variation's own", () => {
      expect(warn(tempo({ referenceExerciseId: "bench" }), [max("tempo", 120)])).toBe(
        'No Bench Press training max for Joey · they see "70% of Bench Press"',
      );
      expect(warn(tempo({ referenceExerciseId: "bench" }), [max("bench", 150)])).toBeNull();
      expect(warn(tempo({ referenceExerciseId: "bench", load: "70% of tested" }), [max("bench", 150)])).toBe(
        'No Bench Press tested max for Joey · they see "70% of Bench Press"',
      );
    });

    it("warns on an own-exercise percentage too, as prescription.ts always said it did", () => {
      expect(warn(tempo(), [])).toBe('No Tempo Bench training max for Joey · they see "70%"');
      expect(warn(tempo(), [max("tempo", 120)])).toBeNull();
    });

    it("says nothing for a non-percentage, or while the maxes are unknown", () => {
      expect(warn(tempo({ load: "@8", referenceExerciseId: "bench" }), [])).toBeNull();
      expect(warn(tempo({ referenceExerciseId: "bench" }), null)).toBeNull();
    });
  });

  it("remembers the last reference used for the same exercise in the program", () => {
    const program = (lines: Prescription[][]): ProgramTree =>
      ({
        athleteId: "joey",
        blocks: [
          {
            weeks: lines.map((days, w) => ({ id: `w${w}`, days: [{ id: `d${w}`, prescriptions: days }] })),
          },
        ],
      }) as unknown as ProgramTree;
    expect(rememberedReference(program([[tempo({ referenceExerciseId: "bench" })]]), "tempo")).toBe("bench");
    expect(rememberedReference(program([[tempo({ referenceExerciseId: "bench" })]]), "squat")).toBeNull();
    // `of own` on the later line stops the inheritance.
    expect(
      rememberedReference(program([[tempo({ referenceExerciseId: "bench" })], [tempo({ referenceExerciseId: null })]]), "tempo"),
    ).toBeNull();
    expect(rememberedReference(program([[tempo({ referenceExerciseId: "cgbp" })], [line()]]), "tempo")).toBe("cgbp");
  });
});

describe("the kilos under a load cell (docs/program-layout.md §1)", () => {
  const names = new Map([
    ["squat", "Squat"],
    ["bench", "Bench Press"],
    ["tempo", "Tempo Bench"],
  ]);
  const max = (exerciseId: string, valueKg: number, kind: "training" | "tested" = "training", effectiveFrom = "2026-09-12T00:00:00Z") => ({
    id: `${exerciseId}-${kind}-${effectiveFrom}`,
    exerciseId,
    kind,
    valueKg,
    effectiveFrom,
    recordedBy: "ruairi",
  });
  const asOf = new Date("2026-10-15T09:00:00Z");
  const preview = (
    l: Prescription,
    entries: ReturnType<typeof max>[] | "loading" | "failed" | "template",
    estimated = new Map<string, { valueKg: number; asOf: string }>(),
    at = asOf,
  ) =>
    loadPreview(l, {
      maxes: typeof entries === "string" ? entries : { entries, estimated },
      nameOf: (id) => names.get(id),
      athleteName: "Joey",
      asOf: at,
    });

  it("gives the kilos, rounded down to the plates, and the max and date they come from", () => {
    expect(preview(line({ load: "75%" }), [max("squat", 190)])).toEqual({
      tone: "resolved",
      text: "→ 142.5 kg · Squat training max 190, set 12 Sep",
    });
    // 72.5% of 150 is 108.75: down to 107.5, never up to 110.
    expect(preview(line({ load: "72.5%" }), [max("squat", 150)])?.text).toBe("→ 107.5 kg · Squat training max 150, set 12 Sep");
  });

  it("keeps a cap's ceiling beside the kilos", () => {
    expect(preview(line({ load: "75% @8" }), [max("squat", 190)])?.text).toBe(
      "→ 142.5 kg, stop at RPE 8 · Squat training max 190, set 12 Sep",
    );
  });

  it("prices a reference row off the competition lift, never the variation's own max", () => {
    const tempo = line({ exerciseId: "tempo", load: "70%", referenceExerciseId: "bench" });
    expect(preview(tempo, [max("tempo", 120), max("bench", 150, "training", "2026-10-01T00:00:00Z")])?.text).toBe(
      "→ 105 kg · Bench Press training max 150, set 1 Oct",
    );
  });

  it("reads the kind the cell names: a tested max, or the e1RM with the date of the set behind it", () => {
    expect(preview(line({ load: "80% of tested" }), [max("squat", 190), max("squat", 200, "tested")])?.text).toBe(
      "→ 160 kg · Squat tested max 200, set 12 Sep",
    );
    const e1rm = new Map([["squat", { valueKg: 182.4, asOf: "2026-10-09T18:00:00Z" }]]);
    expect(preview(line({ load: "80% of e1rm" }), [], e1rm)?.text).toBe("→ 145 kg · Squat e1RM 182.5, from 9 Oct");
  });

  it("says which max is missing for whom, what the athlete will see, and offers to add that max", () => {
    expect(preview(line({ load: "75%" }), [])).toEqual({
      tone: "missing",
      text: 'No Squat training max for Joey · they see "75%"',
      addMax: { exerciseId: "squat", name: "Squat", kind: "training" },
    });
    expect(preview(line({ load: "75% of tested" }), [max("squat", 190)])?.addMax).toEqual({
      exerciseId: "squat",
      name: "Squat",
      kind: "tested",
    });
    expect(preview(line({ exerciseId: "tempo", load: "70%", referenceExerciseId: "bench" }), [max("tempo", 120)])?.addMax).toEqual({
      exerciseId: "bench",
      name: "Bench Press",
      kind: "training",
    });
  });

  it("does not offer to type an e1RM, which only logged sets make", () => {
    const missing = preview(line({ load: "80% of e1rm" }), [max("squat", 190)]);
    expect(missing?.text).toBe('No Squat e1RM yet: nothing logged with an RPE · drop "of e1rm" to use the training max');
    expect(missing?.addMax).toBeUndefined();
  });

  it("calls a max set in advance early rather than missing", () => {
    expect(preview(line({ load: "75%" }), [max("squat", 200, "training", "2026-11-01T00:00:00Z")])?.text).toBe(
      "Squat training max 200 starts 1 Nov · nothing in effect yet",
    );
  });

  it("prices a future day off the max in effect that day", () => {
    const entries = [max("squat", 190), max("squat", 200, "training", "2026-11-01T00:00:00Z")];
    const now = new Date("2026-10-15T09:00:00");
    expect(preview(line({ load: "75%" }), entries, undefined, previewDate("2026-11-03", now))?.text).toBe(
      "→ 150 kg · Squat training max 200, set 1 Nov",
    );
    // A past day the athlete has not opened yet is priced as of today.
    expect(previewDate("2026-10-01", now)).toBe(now);
    expect(previewDate(null, now)).toBe(now);
  });

  it("says plainly what it cannot know yet, and what RPE rows and templates do", () => {
    expect(preview(line({ load: "75%" }), "loading")).toEqual({ tone: "quiet", text: "Kilos appear once Joey's maxes load" });
    expect(preview(line({ load: "75%" }), "failed")).toEqual({ tone: "quiet", text: "Could not read Joey's maxes · kilos unknown" });
    expect(preview(line({ load: "75%" }), "template")?.text).toBe("Template · kilos resolve per athlete");
    expect(preview(line({ load: "@8" }), [max("squat", 190)])?.text).toBe("Athlete picks · no kilos until their first set");
  });

  it("adds nothing where the kind line says it all: fixed, freeform, empty", () => {
    for (const load of ["142.5", "work up to a heavy single", null]) expect(preview(line({ load }), [])).toBeNull();
  });
});

describe("shorthand: 5x3 @8 fills sets, reps and load", () => {
  it.each([
    ["5x3", { setCount: 5, reps: 3, repMax: null }],
    ["5 x 3", { setCount: 5, reps: 3, repMax: null }],
    ["5×3 @8", { setCount: 5, reps: 3, repMax: null, load: "@8" }],
    ["5x3@8", { setCount: 5, reps: 3, repMax: null, load: "@8" }],
    ["3x5 75%", { setCount: 3, reps: 5, repMax: null, load: "75%" }],
    ["3x8-10 @7", { setCount: 3, reps: 8, repMax: 10, load: "@7" }],
    ["4x4 70% of bench", { setCount: 4, reps: 4, repMax: null, load: "70% of bench" }],
    ["3x @8", { setCount: 3, reps: null, repMax: null, load: "@8" }],
  ])("reads %s", (text, value) => {
    expect(parseShorthand(text)).toEqual({ ok: true, value });
  });

  it("leaves everything that is not shorthand to its own cell's grammar", () => {
    for (const text of ["5", "75%", "@8", "142.5", "3x75%", "heavy single"]) expect(parseShorthand(text)).toBeNull();
  });

  it("refuses shorthand whose numbers are out of range, in the cell's own words", () => {
    expect(parseShorthand("60x3")).toEqual({ ok: false, reason: "Sets is a whole number, 1 to 50" });
    expect(parseShorthand("3x10-8")).toEqual({ ok: false, reason: "Reps is a number like 5, or a range like 8-10" });
  });

  const library: Exercise[] = [
    { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
    { id: "bench", name: "Bench Press", normalisedName: "bench press", isGlobal: true },
  ];

  it("in the sets cell, fills sets and reps and leaves the load alone", () => {
    expect(commitCell(line(), "sets", "5x3", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", setCount: 5, reps: 3, repMax: null },
    });
  });

  it("in any of the three cells, fills the load too, sending only what changed", () => {
    expect(commitCell(line(), "reps", "3x5 @8", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "@8" },
    });
    expect(commitCell(line(), "load", "5x3 80%", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", setCount: 5, reps: 3, repMax: null, load: "80%" },
    });
    expect(commitCell(line(), "load", "3x5 75%", library)).toEqual({ unchanged: true });
  });

  it("puts `of <lift>` in the reference column, as the load cell always has", () => {
    expect(commitCell(line(), "sets", "4x4 70% of bench", library)).toEqual({
      op: {
        op: "updatePrescription",
        prescriptionId: "l1",
        setCount: 4,
        reps: 4,
        repMax: null,
        load: "70%",
        referenceExerciseId: "bench",
      },
    });
  });

  it("refuses bad shorthand on the cell and sends nothing", () => {
    expect(commitCell(line(), "sets", "60x3", library)).toEqual({ error: "Sets is a whole number, 1 to 50" });
  });

  it("still reads a plain number as the cell's own value", () => {
    expect(commitCell(line(), "sets", "4", library)).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", setCount: 4 },
    });
  });
});

describe("a progression cell", () => {
  it("shows a line as one shorthand that reads back unchanged", () => {
    expect(progressionText(line())).toBe("3x5 75%");
    expect(progressionText(line({ reps: 8, repMax: 10, load: "@7" }))).toBe("3x8-10 @7");
    expect(progressionText(line({ reps: null, load: "@8" }))).toBe("3x @8");
    expect(progressionText(line({ load: null }))).toBe("3x5");
    expect(commitProgression(line(), "3x5 75%")).toEqual({ unchanged: true });
    expect(commitProgression(line(), " 3x5  75% ")).toEqual({ unchanged: true });
  });

  it("takes text without NxM as the load alone: 75% to 77.5% is one number", () => {
    expect(commitProgression(line(), "77.5%")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "77.5%" },
    });
  });

  it("takes shorthand as the whole line, so leaving the load off clears it", () => {
    expect(commitProgression(line(), "4x3 80%")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", setCount: 4, reps: 3, repMax: null, load: "80%" },
    });
    expect(commitProgression(line(), "3x5")).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", load: "" } });
  });

  it("puts an emptied cell back rather than reading it as remove", () => {
    expect(commitProgression(line(), "   ")).toEqual({ unchanged: true });
  });

  it("refuses bad shorthand", () => {
    expect(commitProgression(line(), "0x5 75%")).toEqual({ error: "Sets is a whole number, 1 to 50" });
  });
});
