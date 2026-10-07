import { estimateOneRepMax } from "@/lib/strength/e1rm";
import { resolvePrefill } from "@/lib/logging/prefill";
import type { ReferenceMaxEntry } from "@/lib/strength/reference-max";
import type { Prescription } from "./program";
import type { PlannedRow } from "@/lib/logging/plan";
import {
  basisMaxesFor,
  lineSummaries,
  nextTarget,
  planDay,
  prefillFrom,
  prescribeNewRows,
  referenceLookup,
  repsLabel,
  targetLine,
  targetsFor,
} from "./session-plan";

let seq = 0;
const line = (over: Partial<Prescription>): Prescription => ({
  id: `l${++seq}`,
  programId: "p1",
  weekId: "w1",
  dayId: "d1",
  exerciseId: "squat",
  position: seq,
  setCount: 1,
  reps: 5,
  repMax: null,
  load: null,
  loadKind: null,
  restSeconds: null,
  notes: null,
  updatedAt: "2026-09-20T00:00:00.000Z",
  ...over,
});

const set = (loadKg: number, reps: number, rpe: number | null, isWarmup = false) => ({ loadKg, reps, rpe, isWarmup });

describe("planning a day", () => {
  it("groups lines by exercise in the order each first appears", () => {
    const plan = planDay([
      line({ id: "a", exerciseId: "squat", position: 0 }),
      line({ id: "b", exerciseId: "bench", position: 1 }),
      line({ id: "c", exerciseId: "squat", position: 2 }),
    ]);
    expect(plan.map((p) => p.exerciseId)).toEqual(["squat", "bench"]);
    expect(plan[0].lines.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("follows position, not the order rows came back in", () => {
    const plan = planDay([line({ id: "late", exerciseId: "bench", position: 5 }), line({ id: "early", position: 0 })]);
    expect(plan.map((p) => p.exerciseId)).toEqual(["squat", "bench"]);
  });
});

describe("resolving targets", () => {
  const squat = () =>
    planDay([
      line({ id: "top", setCount: 1, reps: 5, load: "@8" }),
      line({ id: "back", setCount: 3, reps: 5, load: "75%" }),
    ])[0];

  it("expands lines into one target per prescribed set", () => {
    const targets = targetsFor(squat(), { training: 200 });
    expect(targets.map((t) => [t.prescriptionId, t.setNumber])).toEqual([
      ["top", 1],
      ["back", 2],
      ["back", 3],
      ["back", 4],
    ]);
    expect(targets.every((t) => t.totalSets === 4)).toBe(true);
  });

  it("prices a percentage off the training max before anything is logged, rounded down", () => {
    // 75% of 203 is 152.25 -- down to 150, never up to 152.5.
    const [top, back] = targetsFor(squat(), { training: 203 });
    expect(top).toMatchObject({ loadKg: null, rpe: 8, display: "RPE 8", synced: false });
    expect(back).toMatchObject({ loadKg: 150, display: "150 kg (75%)", synced: false, anchor: null });
  });

  it("re-prices the backoffs off today's top set once it is logged, as a suggestion", () => {
    const topSet = set(170, 5, 8);
    const e1rm = estimateOneRepMax(topSet)!;
    const back = targetsFor(squat(), { training: 180 }, [topSet])[1];
    expect(back.synced).toBe(true);
    expect(back.loadKg).toBe(Math.floor((0.75 * e1rm) / 2.5) * 2.5);
    expect(back.anchor).toEqual({ loadKg: 170, reps: 5, rpe: 8 });
  });

  it("does not re-price off a warm-up or a set logged without an RPE", () => {
    const back = targetsFor(squat(), { training: 200 }, [set(100, 5, null, true), set(170, 5, null)])[1];
    expect(back).toMatchObject({ loadKg: 150, synced: false });
  });

  it("leaves an unresolvable percentage as a percentage rather than guessing", () => {
    const back = targetsFor(squat(), {})[1];
    expect(back).toMatchObject({ loadKg: null, unresolved: true, display: "75%" });
  });

  it("handles every kind, including a line with no load at all", () => {
    const plan = planDay([
      line({ setCount: 1, load: "142.5" }),
      line({ setCount: 1, load: "72.5% @8" }),
      line({ setCount: 1, load: "moderate, 2 in the tank" }),
      line({ setCount: 1, load: null }),
    ])[0];
    const targets = targetsFor(plan, { training: 120 });
    expect(targets.map((t) => t.kind)).toEqual(["fixed", "capped", "freeform", null]);
    expect(targets.map((t) => t.loadKg)).toEqual([142.5, 85, null, null]);
    expect(targets[1].rpe).toBe(8);
    expect(targets[2].display).toBe("moderate, 2 in the tank");
    expect(targets[3].display).toBe("");
  });

  it("writes a snapshot a set can carry, whatever the plan says later", () => {
    const [top, back] = targetsFor(squat(), { training: 200 });
    expect(top.snapshot).toBe("5 reps · RPE 8");
    expect(back.snapshot).toBe("5 reps · 150 kg (75%)");
    const single = targetsFor(planDay([line({ reps: 1, load: "@9" })])[0], {})[0];
    expect(single.snapshot).toBe("1 rep · RPE 9");
    const range = targetsFor(planDay([line({ reps: 8, repMax: 10, load: null })])[0], {})[0];
    expect(range.snapshot).toBe("8–10 reps");
  });
});

describe("the next set", () => {
  const plan = () =>
    planDay([line({ id: "top", setCount: 1, load: "@8" }), line({ id: "back", setCount: 2, load: "75%" })])[0];

  it("counts working sets only, so warm-ups never consume a prescribed set", () => {
    const logged = [set(60, 5, null, true), set(100, 3, null, true)];
    const targets = targetsFor(plan(), { training: 200 }, logged);
    expect(nextTarget(targets, logged)?.prescriptionId).toBe("top");
  });

  it("moves on as sets are logged, and runs out after the last prescribed set", () => {
    const one = [set(170, 5, 8)];
    expect(nextTarget(targetsFor(plan(), {}, one), one)?.setNumber).toBe(2);
    const all = [set(170, 5, 8), set(152.5, 5, null), set(152.5, 5, null)];
    expect(nextTarget(targetsFor(plan(), {}, all), all)).toBeNull();
  });

  it("describes itself in one line", () => {
    const targets = targetsFor(plan(), { training: 200 });
    expect(targetLine(targets[1])).toBe("Set 2 of 3 · 5 reps · 150 kg (75%)");
  });
});

describe("what the athlete reads above the rows", () => {
  it("summarises each line, and says when a weight came from today's top set", () => {
    const plan = planDay([
      line({ setCount: 1, load: "@8" }),
      line({ setCount: 3, load: "75%", notes: "belt on" }),
      line({ setCount: 3, reps: 8, repMax: 10, load: null }),
    ])[0];
    expect(lineSummaries(plan, targetsFor(plan, { training: 200 }))).toEqual([
      "1 × 5 · RPE 8",
      "3 × 5 · 150 kg (75%) — belt on",
      "3 × 8–10",
    ]);
    const synced = targetsFor(plan, { training: 200 }, [set(170, 5, 8)]);
    expect(lineSummaries(plan, synced)[1]).toMatch(/\(from today's top set\)/);
  });

  it("labels reps as a count, a range, or nothing", () => {
    expect(repsLabel(5, null)).toBe("5");
    expect(repsLabel(8, 10)).toBe("8–10");
    expect(repsLabel(5, 5)).toBe("5");
    expect(repsLabel(null, null)).toBe("");
  });
});

describe("feeding the set row's prefill", () => {
  const plan = () => planDay([line({ setCount: 1, load: "@8" }), line({ setCount: 2, load: "75%" })])[0];

  it("gives a stored-max weight to prefill as the coach's prescription", () => {
    const target = targetsFor(plan(), { training: 200 })[1];
    expect(resolvePrefill(prefillFrom(target))).toMatchObject({ loadKg: 150, reps: 5, source: "prescribed" });
  });

  it("gives a weight priced off today's top set as a suggestion, never as the coach's number", () => {
    const logged = [set(170, 5, 8)];
    const target = nextTarget(targetsFor(plan(), { training: 200 }, logged), logged)!;
    const prefill = resolvePrefill(prefillFrom(target));
    expect(prefill.source).toBe("suggested");
    expect(prefill.note).toBe("suggested from RPE 8 @ 170");
  });

  it("keeps the reps of an RPE set but leaves its load to the athlete", () => {
    const target = targetsFor(plan(), {})[0];
    expect(resolvePrefill(prefillFrom(target))).toMatchObject({ loadKg: null, reps: 5, source: "empty" });
    // ...and repeating the previous set still fills it, per prefill rule 3.
    expect(resolvePrefill({ ...prefillFrom(target), previousSetThisSession: { loadKg: 160, reps: 5 } })).toMatchObject({
      loadKg: 160,
      reps: 5,
    });
  });

  it("is empty with no target, so free logging behaves exactly as before", () => {
    expect(prefillFrom(null)).toEqual({ prescription: null, suggestion: null });
  });
});

describe("the maxes a percentage resolves against", () => {
  const entry = (over: Partial<ReferenceMaxEntry>): ReferenceMaxEntry => ({
    id: `m${++seq}`,
    exerciseId: "squat",
    kind: "training",
    valueKg: 200,
    effectiveFrom: "2026-09-01T00:00:00.000Z",
    recordedBy: "ruairi",
    ...over,
  });

  it("takes each kind for this exercise as of the date, and the estimate from the rollups", () => {
    const maxes = basisMaxesFor(
      "squat",
      [
        entry({ valueKg: 200 }),
        entry({ valueKg: 210, effectiveFrom: "2026-10-12T00:00:00.000Z" }),
        entry({ kind: "tested", valueKg: 220 }),
        entry({ exerciseId: "bench", valueKg: 140 }),
      ],
      new Map([["squat", { valueKg: 215, asOf: "2026-09-21T00:00:00.000Z" }]]),
      new Date("2026-09-28T00:00:00.000Z"),
    );
    // Next block's training max is dated in the future and stays invisible.
    expect(maxes).toEqual({ training: 200, tested: 220, estimated: 215 });
  });

  it("is empty for an exercise with no maxes", () => {
    expect(basisMaxesFor("row", [], new Map(), new Date())).toEqual({ training: null, tested: null, estimated: null });
  });
});

describe("stamping the logger's new rows with their targets", () => {
  // Squat: 3 x 5 at a fixed 140, then 1 x 3 at RPE 8.
  const squat = () =>
    planDay([
      line({ id: "work", setCount: 3, reps: 5, load: "140" }),
      line({ id: "top", setCount: 1, reps: 3, load: "@8" }),
    ])[0];
  const row = (clientSetId: string, over: Partial<PlannedRow> = {}): PlannedRow => ({
    exerciseId: "squat",
    clientSetId,
    loadKg: null,
    reps: null,
    rpe: null,
    isWarmup: false,
    planned: false,
    ...over,
  });
  const context = (logged: ReturnType<typeof set>[]) => (exerciseId: string) =>
    exerciseId === "squat"
      ? { logged, targets: targetsFor(squat(), {}, logged) }
      : { logged: [], targets: null };

  it("prefills a fresh row with the first prescribed set and remembers what it answers", () => {
    const [stamped] = prescribeNewRows([], [row("r1")], context([]));
    expect(stamped).toMatchObject({ loadKg: 140, reps: 5, prescriptionId: "work" });
    expect(stamped.prescribed).toBe("5 reps · 140 kg");
  });

  it("counts logged working sets and the rows ahead, so a third row gets set 3 and a fourth the top set", () => {
    const logged = [set(60, 5, null, true), set(140, 5, 8)];
    const before = [row("r2", { loadKg: 140, reps: 5 })];
    const after = prescribeNewRows(before, [...before, row("r3"), row("r4", { loadKg: 140, reps: 5 })], context(logged));
    expect(after[1]).toMatchObject({ prescriptionId: "work", loadKg: 140, reps: 5 });
    // An RPE line names no weight, so the repeated load stays and the reps change.
    expect(after[2]).toMatchObject({ prescriptionId: "top", loadKg: 140, reps: 3 });
  });

  it("drops the suggested flag when the coach's number replaces the engine's", () => {
    const suggested = row("r1", { loadKg: 175, reps: 5, note: "suggested from RPE 7 @ 170", suggested: true });
    const [stamped] = prescribeNewRows([], [suggested], context([]));
    // The first squat line prescribes 140 kg: the coach's, not a suggestion.
    expect(stamped).toMatchObject({ loadKg: 140, suggested: false });
  });

  it("keeps the flag on a suggestion when the line prescribes RPE and no weight", () => {
    const logged = [set(140, 5, 8)];
    const suggested = row("r3", { loadKg: 145, reps: 5, note: "suggested from RPE 7 @ 140", suggested: true });
    // The third new row is the squat plan's RPE top set: reps and RPE, no load.
    const [, , kept] = prescribeNewRows([], [row("r1"), row("r2"), suggested], context(logged));
    expect(kept).toMatchObject({ loadKg: 145, suggested: true, note: "suggested from RPE 7 @ 140" });
  });

  it("never touches a row already on screen, whatever the athlete typed into it", () => {
    const typed = row("r1", { loadKg: 150, reps: 4 });
    expect(prescribeNewRows([typed], [typed], context([]))[0]).toEqual(typed);
  });

  it("leaves extra sets beyond the prescription, warm-ups and unprescribed exercises alone", () => {
    const logged = [set(140, 5, 7), set(140, 5, 7), set(140, 5, 7), set(150, 3, 8)];
    const [extra, warmup, bench] = prescribeNewRows(
      [],
      [row("x", { loadKg: 150, reps: 3 }), row("w", { isWarmup: true }), row("b", { exerciseId: "bench" })],
      context(logged),
    );
    expect(extra).toEqual(row("x", { loadKg: 150, reps: 3 }));
    expect(warmup.prescriptionId).toBeUndefined();
    expect(bench.prescriptionId).toBeUndefined();
  });
});

/**
 * docs/reference-lift.md §6, ported from the design's scratch script. Ruairi,
 * 7 Oct 2026: "Tempo Bench at 70%" is 70% of the competition bench max.
 */
describe("a percentage of another lift: the worked examples", () => {
  const max = (over: Partial<ReferenceMaxEntry>): ReferenceMaxEntry => ({
    id: `m${++seq}`,
    exerciseId: "bench",
    kind: "training",
    valueKg: 150,
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    recordedBy: "ruairi",
    ...over,
  });
  const names = new Map([
    ["bench", "Bench Press"],
    ["tempo", "Tempo Bench"],
  ]);
  const lookup = (entries: ReferenceMaxEntry[], asOf: string, estimated = new Map()) =>
    referenceLookup(entries, estimated, new Date(asOf), (id) => names.get(id));
  /** A Tempo Bench line, referencing the comp bench unless told otherwise. */
  const tempo = (load: string, over: Partial<Prescription> = {}) =>
    planDay([line({ exerciseId: "tempo", setCount: 3, reps: 5, load, referenceExerciseId: "bench", ...over })])[0];
  const target = (
    load: string,
    entries: ReferenceMaxEntry[],
    asOf = "2026-10-15T09:00:00.000Z",
    extra: { own?: Parameters<typeof targetsFor>[1]; logged?: ReturnType<typeof set>[]; estimated?: Map<string, { valueKg: number; asOf: string }>; over?: Partial<Prescription> } = {},
  ) => targetsFor(tempo(load, extra.over), extra.own ?? {}, extra.logged ?? [], lookup(entries, asOf, extra.estimated))[0];

  it("1. comp bench training 150: Tempo Bench 70% referencing it is 105 kg, and the tempo max is not consulted", () => {
    const t = target("70%", [max({}), max({ exerciseId: "tempo", valueKg: 120 })], undefined, { own: { training: 120 } });
    expect(t).toMatchObject({ loadKg: 105, display: "105 kg (70% of Bench Press)", synced: false, unresolved: false });
    // The same row on its own max -- today's behaviour -- is 84 rounded down.
    const own = targetsFor(tempo("70%", { referenceExerciseId: null }), { training: 120 })[0];
    expect(own).toMatchObject({ loadKg: 82.5, display: "82.5 kg (70%)" });
    expect(target("72.5%", [max({})]).loadKg).toBe(107.5);
  });

  it("2. the kind is the load text's, on the reference lift", () => {
    const entries = [max({ kind: "tested", valueKg: 157.5, effectiveFrom: "2026-09-20T00:00:00.000Z" }), max({})];
    const estimated = new Map([["bench", { valueKg: 160, asOf: "2026-10-05T00:00:00.000Z" }]]);
    expect(target("70%", entries, undefined, { estimated }).loadKg).toBe(105);
    // 110.25 and 112, both rounded down.
    expect(target("70% of tested", entries, undefined, { estimated }).loadKg).toBe(110);
    expect(target("70% of e1rm", entries, undefined, { estimated }).loadKg).toBe(110);
    expect(target("70% @8", entries, undefined, { estimated })).toMatchObject({ loadKg: 105, rpe: 8 });
    expect(target("70% of tested", entries).snapshot).toBe("5 reps · 110 kg (70% of Bench Press, tested 157.5)");
  });

  it("3. the reference max moves mid-block: the live line follows it, the logged set's snapshot does not", () => {
    const entries = [
      max({ valueKg: 150 }),
      max({ valueKg: 155, effectiveFrom: "2026-10-20T00:00:00.000Z" }),
      max({ valueKg: 160, effectiveFrom: "2026-11-01T00:00:00.000Z" }),
    ];
    const oct15 = target("70%", entries, "2026-10-15T09:00:00.000Z");
    expect(oct15.loadKg).toBe(105);
    const [logged] = prescribeNewRows(
      [],
      [{ exerciseId: "tempo", clientSetId: "s1", loadKg: null, reps: null, rpe: null, isWarmup: false, planned: false }],
      () => ({ logged: [], targets: [oct15] }),
    );
    expect(logged).toMatchObject({ loadKg: 105, prescribed: "5 reps · 105 kg (70% of Bench Press, training 150)" });

    // A week later: 70% of 155 = 108.5, floored. The 1 Nov entry is invisible.
    const oct22 = target("70%", entries, "2026-10-22T09:00:00.000Z");
    expect(oct22).toMatchObject({ loadKg: 107.5, snapshot: "5 reps · 107.5 kg (70% of Bench Press, training 155)" });
    // A typo fix dated 1 Oct, entered later, wins the tie for 15 Oct from now on.
    const fixed = target("70%", [...entries, max({ valueKg: 152.5 })], "2026-10-15T09:00:00.000Z");
    expect(fixed.snapshot).toBe("5 reps · 105 kg (70% of Bench Press, training 152.5)");
    // The set already on screen is never re-priced, and its snapshot stays put.
    expect(prescribeNewRows([logged], [logged], () => ({ logged: [], targets: [oct22] }))[0]).toEqual(logged);
    expect(logged.prescribed).toBe("5 reps · 105 kg (70% of Bench Press, training 150)");
  });

  it("4. the reference lift has no max: unresolved, the lift named, the own max not used", () => {
    const tempoOnly = [max({ exerciseId: "tempo", valueKg: 120 })];
    const future = [max({ effectiveFrom: "2026-12-01T00:00:00.000Z" })];
    for (const entries of [tempoOnly, future]) {
      expect(target("70%", entries, undefined, { own: { training: 120 } })).toMatchObject({
        loadKg: null,
        unresolved: true,
        display: "70% of Bench Press",
        snapshot: "5 reps · 70% of Bench Press",
      });
    }
    expect(target("70% @8", tempoOnly)).toMatchObject({ loadKg: null, rpe: 8, display: "70% of Bench Press, stop at RPE 8" });
    // No lookup at all is the same honest failure, never the own max.
    expect(targetsFor(tempo("70%"), { training: 120 })[0]).toMatchObject({ loadKg: null, unresolved: true });
  });

  it("5. a reference row is never priced off its own exercise's sets (phase 1)", () => {
    // Today's comp bench single: 145 x 1 @9 is an e1RM of 149.1. Priced off
    // it, 70% is 102.5 -- phase 2's answer, still [SME to confirm], so a bench
    // line of its own gets it and the tempo line does not.
    expect(estimateOneRepMax({ loadKg: 145, reps: 1, rpe: 9 })).toBeCloseTo(149.1, 1);
    const benchOwn = planDay([line({ exerciseId: "bench", setCount: 3, reps: 5, load: "70%" })])[0];
    expect(targetsFor(benchOwn, { training: 150 }, [set(145, 1, 9)])[0]).toMatchObject({ loadKg: 102.5, synced: true });

    // The tempo bench's own first set, 110 x 5 @8, is an e1RM of 132: 70% of
    // it is 90 kg, the wrong lift. The reference row stays on the stored bench max.
    const tempoSet = [set(110, 5, 8)];
    expect(estimateOneRepMax({ loadKg: 110, reps: 5, rpe: 8 })).toBeCloseTo(132, 0);
    const own = targetsFor(tempo("70%", { referenceExerciseId: null }), {}, tempoSet)[0];
    expect(own).toMatchObject({ loadKg: 90, synced: true });
    const referenced = target("70%", [max({})], undefined, { logged: tempoSet });
    expect(referenced).toMatchObject({ loadKg: 105, synced: false, anchor: null });
    expect(target("70% of tested", [max({ kind: "tested", valueKg: 157.5 })], undefined, { logged: tempoSet }).loadKg).toBe(110);
  });

  it("keeps the reference for a non-percentage load without consulting it", () => {
    const t = target("@8", [max({})]);
    expect(t).toMatchObject({ loadKg: null, rpe: 8, display: "RPE 8", unresolved: false });
    // A reference to the line's own exercise is no reference.
    const self = targetsFor(tempo("70%", { referenceExerciseId: "tempo" }), { training: 120 })[0];
    expect(self.display).toBe("82.5 kg (70%)");
  });

  it("names the lift on the line summary only when a reference is set", () => {
    const plan = planDay([
      line({ id: "ref", exerciseId: "tempo", setCount: 3, reps: 5, load: "70%", referenceExerciseId: "bench" }),
      line({ id: "own", exerciseId: "tempo", setCount: 2, reps: 5, load: "70%" }),
    ])[0];
    expect(lineSummaries(plan, targetsFor(plan, { training: 120 }, [], lookup([max({})], "2026-10-15T09:00:00.000Z")))).toEqual([
      "3 × 5 · 105 kg (70% of Bench Press)",
      "2 × 5 · 82.5 kg (70%)",
    ]);
  });
});
