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
