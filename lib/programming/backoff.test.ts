import type { PlannedRow } from "@/lib/logging/plan";
import { roundToLoadable } from "@/lib/strength/plates";
import {
  DEFAULT_DROP_CAP,
  backoffDisplay,
  backoffLoad,
  backoffRun,
  describeBackoff,
  formatBackoff,
  normaliseBackoff,
  parseBackoff,
  readBackoff,
  topSetOf,
  type BackoffRule,
} from "./backoff";
import { applyLineOp, cellText, COLUMNS, commitCell, describeBackoffCell } from "./editor";
import { readProgramOp, type Prescription } from "./program";
import { lineSummaries, nextTarget, planDay, prefillFrom, prescribeNewRows, targetLine, targetsFor } from "./session-plan";

const set = (loadKg: number, reps: number, rpe: number | null, isWarmup = false) => ({ loadKg, reps, rpe, isWarmup });

const rule = (text: string): BackoffRule => {
  const parsed = parseBackoff(text);
  if (!parsed.ok || !parsed.rule) throw new Error(`did not parse: ${text}`);
  return parsed.rule;
};

describe("parsing a backoff cell", () => {
  it("reads N sets at a percentage of the top set, in either order and either sign", () => {
    const ninety = { kind: "percent", sets: 3, percent: 90 };
    for (const text of ["3 x 90%", "3x90%", "3 × 90 %", "3 * 90%", "90% x 3", "3 x -10%", "-10% x 3", "  3 X 90%  "]) {
      expect(parseBackoff(text), text).toEqual({ ok: true, rule: ninety });
    }
    expect(rule("2 x 87.5%")).toEqual({ kind: "percent", sets: 2, percent: 87.5 });
    expect(rule("1 x 100%")).toEqual({ kind: "percent", sets: 1, percent: 100 });
  });

  it("reads a load drop repeated until an RPE, with an optional cap", () => {
    expect(rule("-5% until @9")).toEqual({ kind: "drop", dropPercent: 5, untilRpe: 9, maxSets: null });
    expect(rule("-7.5% to rpe 8.5")).toEqual({ kind: "drop", dropPercent: 7.5, untilRpe: 8.5, maxSets: null });
    expect(rule("-5% until @9 max 4")).toEqual({ kind: "drop", dropPercent: 5, untilRpe: 9, maxSets: 4 });
    expect(rule("-5% until @9, max 4")).toEqual({ kind: "drop", dropPercent: 5, untilRpe: 9, maxSets: 4 });
  });

  it("reads a repeat as a drop of nothing", () => {
    expect(rule("repeat until @9")).toEqual({ kind: "drop", dropPercent: 0, untilRpe: 9, maxSets: null });
    expect(rule("same to rpe9")).toEqual({ kind: "drop", dropPercent: 0, untilRpe: 9, maxSets: null });
  });

  it("treats an empty cell as no backoff", () => {
    expect(parseBackoff("")).toEqual({ ok: true, rule: null });
    expect(parseBackoff("   ")).toEqual({ ok: true, rule: null });
    expect(parseBackoff(null)).toEqual({ ok: true, rule: null });
  });

  it("refuses rather than guesses -- a typo here is a wrong weight on several sets", () => {
    for (const text of [
      "3 x 110%", // above the top set is not a backoff
      "3 x 0%",
      "3 x -100%",
      "0 x 90%",
      "21 x 90%",
      "-50% until @9", // half the bar is a typo
      "-5% until @12", // not on the chart
      "-5% until @8.25",
      "-5% until @9 max 0",
      "then drop a bit",
      "90%", // how many sets?
      "3 x 90", // percent of what?
      "x".repeat(41),
    ]) {
      const parsed = parseBackoff(text);
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) expect(parsed.reason.length).toBeGreaterThan(0);
    }
  });

  it("round-trips through its canonical spelling", () => {
    for (const text of ["3 x 90%", "2 x 87.5%", "-5% until @9", "repeat until @8.5", "-10% until @9 max 3"]) {
      const r = rule(text);
      expect(formatBackoff(r)).toBe(text);
      expect(rule(formatBackoff(r))).toEqual(r);
    }
    expect(normaliseBackoff("-10%x3")).toBe("3 x 90%");
    expect(normaliseBackoff("same to rpe 9")).toBe("repeat until @9");
    expect(normaliseBackoff("")).toBeNull();
    expect(() => normaliseBackoff("3 x 110%")).toThrow();
  });

  it("reads a stored row that somehow does not parse as no backoff, never a broken one", () => {
    expect(readBackoff("nonsense")).toBeNull();
    expect(readBackoff(null)).toBeNull();
    expect(readBackoff("3 x 90%")).toEqual({ kind: "percent", sets: 3, percent: 90 });
  });

  it("describes itself for the editor's indicator", () => {
    expect(describeBackoff(null)).toBe("No backoff");
    expect(describeBackoff(rule("3 x 90%"))).toBe("3 sets at 90% of today's top set");
    expect(describeBackoff(rule("1 x 90%"))).toBe("1 set at 90% of today's top set");
    expect(describeBackoff(rule("-5% until @9"))).toBe(`Top set −5%, repeat until RPE 9 (max ${DEFAULT_DROP_CAP})`);
    expect(describeBackoff(rule("repeat until @9 max 3"))).toBe("Top set weight, repeat until RPE 9 (max 3)");
  });
});

describe("the top set", () => {
  it("is the heaviest working set actually logged", () => {
    expect(topSetOf([set(170, 3, 7), set(180, 3, 8), set(175, 3, 8.5)])).toEqual({ loadKg: 180, reps: 3, rpe: 8 });
  });

  it("never a warm-up, however heavy", () => {
    expect(topSetOf([set(190, 1, null, true), set(180, 3, 8)])).toEqual({ loadKg: 180, reps: 3, rpe: 8 });
    expect(topSetOf([set(100, 5, null, true)])).toBeNull();
  });

  it("goes to the later set on a tie -- the one just done", () => {
    expect(topSetOf([set(180, 3, 8), set(180, 2, 9)])).toEqual({ loadKg: 180, reps: 2, rpe: 9 });
  });

  it("is nothing when nothing usable is logged", () => {
    expect(topSetOf([])).toBeNull();
    expect(topSetOf([set(0, 5, 8)])).toBeNull();
  });
});

describe("the backoff load", () => {
  it("[Inference] percent: top set load x percent, rounded down to 2.5kg by Order 18's own function", () => {
    expect(backoffLoad(rule("3 x 90%"), 180)).toBe(160); // 162 exact
    expect(backoffLoad(rule("3 x 90%"), 200)).toBe(180);
    expect(backoffLoad(rule("3 x 85%"), 182.5)).toBe(155); // 155.125 exact
    expect(backoffLoad(rule("3 x 70%"), 175)).toBe(122.5); // exactly loadable, not lost to float error
    for (const top of [100, 142.5, 177.5, 201, 262.5]) {
      expect(backoffLoad(rule("2 x 80%"), top)).toBe(roundToLoadable((top * 80) / 100));
    }
  });

  it("[Inference] drop: top set load minus the drop, rounded down the same way", () => {
    expect(backoffLoad(rule("-5% until @9"), 180)).toBe(170); // 171 exact
    expect(backoffLoad(rule("-10% until @8"), 200)).toBe(180);
    expect(backoffLoad(rule("-7.5% until @9"), 150)).toBe(137.5); // 138.75 exact
  });

  it("never rounds up -- a shade light beats a missed rep", () => {
    for (const top of [101, 143, 187.5, 219]) {
      const kg = backoffLoad(rule("3 x 92.5%"), top)!;
      expect(kg).toBeLessThanOrEqual((top * 92.5) / 100);
      expect((top * 92.5) / 100 - kg).toBeLessThan(2.5);
    }
  });

  it("keeps the top set's exact load for a repeat or 100%, because that weight is already on the bar", () => {
    expect(backoffLoad(rule("repeat until @9"), 181)).toBe(181);
    expect(backoffLoad(rule("2 x 100%"), 181)).toBe(181);
  });

  it("is nothing rather than 0 kg when the top set is too light to take a percentage of", () => {
    expect(backoffLoad(rule("3 x 50%"), 4)).toBeNull();
    expect(backoffLoad(rule("3 x 90%"), 0)).toBeNull();
    expect(backoffLoad(rule("3 x 90%"), Number.NaN)).toBeNull();
  });

  it("reads as kilos with the rule beside them, or the rule alone before a top set", () => {
    expect(backoffDisplay(rule("3 x 90%"), 160)).toBe("160 kg (90% of top set)");
    expect(backoffDisplay(rule("3 x 90%"), null)).toBe("90% of top set");
    expect(backoffDisplay(rule("-5% until @9"), 170)).toBe("170 kg (top set −5%), until RPE 9");
    expect(backoffDisplay(rule("repeat until @9"), 180)).toBe("180 kg (top set weight), until RPE 9");
    expect(backoffDisplay(rule("-5% until @9"), null)).toBe("top set −5%, until RPE 9");
  });
});

describe("how long a backoff runs", () => {
  it("percent: exactly N", () => {
    expect(backoffRun(rule("3 x 90%"), [])).toEqual({ sets: 3, done: false });
    expect(backoffRun(rule("3 x 90%"), [set(160, 3, 7), set(160, 3, 7), set(160, 3, 8)])).toEqual({ sets: 3, done: true });
  });

  it("drop: one more set until a logged set reaches the stop RPE, that set included", () => {
    const r = rule("-5% until @9");
    expect(backoffRun(r, [])).toEqual({ sets: 1, done: false });
    expect(backoffRun(r, [set(170, 3, 8)])).toEqual({ sets: 2, done: false });
    expect(backoffRun(r, [set(170, 3, 8), set(170, 3, 9)])).toEqual({ sets: 2, done: true });
    expect(backoffRun(r, [set(170, 3, 9.5)])).toEqual({ sets: 1, done: true });
  });

  it("drop: a set logged without an RPE cannot end the run", () => {
    expect(backoffRun(rule("-5% until @9"), [set(170, 3, null)])).toEqual({ sets: 2, done: false });
  });

  it("drop: stops at the coach's cap, or the default one, and leaves later sets to later lines", () => {
    const eights = Array.from({ length: 8 }, () => set(170, 3, 8));
    expect(backoffRun(rule("-5% until @9 max 2"), eights)).toEqual({ sets: 2, done: true });
    expect(backoffRun(rule("-5% until @9"), eights)).toEqual({ sets: DEFAULT_DROP_CAP, done: true });
  });
});

/* -------------------------------------------------------------------------
 * In the logger: session-plan executing the rule
 * ---------------------------------------------------------------------- */

let seq = 0;
const line = (over: Partial<Prescription>): Prescription => ({
  id: `l${++seq}`,
  programId: "p1",
  weekId: "w1",
  dayId: "d1",
  exerciseId: "squat",
  position: seq,
  setCount: 1,
  reps: 3,
  repMax: null,
  load: "@8",
  loadKind: "rpe",
  restSeconds: null,
  notes: null,
  backoff: null,
  updatedAt: "2026-10-06T00:00:00.000Z",
  ...over,
});

describe("backoff targets in the logger", () => {
  const squat = (backoff: string, more: Prescription[] = []) =>
    planDay([line({ id: "top", backoff }), ...more])[0];

  it("before the top set: the rule, with no load and no guess", () => {
    const targets = targetsFor(squat("3 x 90%"), { training: 200 });
    expect(targets).toHaveLength(4);
    expect(targets.slice(1).map((t) => [t.setNumber, t.loadKg, t.display, t.unresolved])).toEqual([
      [2, null, "90% of top set", true],
      [3, null, "90% of top set", true],
      [4, null, "90% of top set", true],
    ]);
    // Never a stored max standing in for the top set, whatever it would give.
    expect(targets.every((t) => t.prescriptionId === "top")).toBe(true);
  });

  it("after the top set: priced off the weight the athlete ACTUALLY lifted, not a prescribed one", () => {
    // Prescribed @8 with a 200 training max; the athlete had a good day at 185.
    const targets = targetsFor(squat("3 x 90%"), { training: 200 }, [set(185, 3, 8)]);
    expect(targets.slice(1).map((t) => t.loadKg)).toEqual([165, 165, 165]); // 166.5 exact
    expect(targets[1]).toMatchObject({
      display: "165 kg (90% of top set)",
      synced: false,
      unresolved: false,
      kind: null,
      rpe: null,
      snapshot: "3 reps · 165 kg (90% of top set)",
      backoff: { topSet: { loadKg: 185, reps: 3, rpe: 8 } },
    });
  });

  it("ignores warm-ups entirely: they neither fill the top set's slot nor count as it", () => {
    const logged = [set(60, 5, null, true), set(140, 3, null, true), set(190, 1, null, true), set(180, 3, 8)];
    const targets = targetsFor(squat("3 x 90%"), {}, logged);
    expect(targets[1].backoff?.topSet).toEqual({ loadKg: 180, reps: 3, rpe: 8 });
    expect(targets[1].loadKg).toBe(160);
    expect(nextTarget(targets, logged)?.setNumber).toBe(2);
  });

  it("takes the heaviest of a multi-set top line, and only that line's sets", () => {
    const plan = planDay([
      line({ id: "top", setCount: 2, backoff: "2 x 80%" }),
      line({ id: "later", setCount: 1, load: "100", loadKind: "fixed" }),
    ])[0];
    const logged = [set(170, 3, 7), set(180, 3, 8), set(145, 3, 7), set(145, 3, 7), set(200, 1, 9)];
    const targets = targetsFor(plan, {}, logged);
    expect(targets.map((t) => t.prescriptionId)).toEqual(["top", "top", "top", "top", "later"]);
    expect(targets[2].loadKg).toBe(142.5); // 80% of 180, not of the later 200
  });

  it("works on a freeform top line: the rule needs the athlete's set, not a parseable load", () => {
    const plan = planDay([line({ id: "top", load: "work up to a heavy triple", loadKind: "freeform", backoff: "2 x 85%" })])[0];
    const before = targetsFor(plan, {});
    expect(before[0].display).toBe("work up to a heavy triple");
    expect(before[1].display).toBe("85% of top set");
    const after = targetsFor(plan, {}, [set(170, 3, null)]);
    expect(after[1].loadKg).toBe(142.5); // 144.5 exact; an RPE is not needed for a load rule
  });

  it("works on a line with no load at all", () => {
    const plan = planDay([line({ id: "top", load: null, loadKind: null, backoff: "1 x 90%" })])[0];
    expect(targetsFor(plan, {}, [set(100, 3, 8)])[1].loadKg).toBe(90);
  });

  it("drop until RPE: one set at a time, ending when the athlete logs the stop RPE", () => {
    const plan = squat("-5% until @9");
    const open = targetsFor(plan, {}, [set(180, 3, 8)]);
    expect(open.map((t) => t.loadKg)).toEqual([null, 170]);
    expect(open[1]).toMatchObject({ rpe: 9, display: "170 kg (top set −5%), until RPE 9" });
    expect(targetLine(open[1])).toBe("Set 2 · 3 reps · 170 kg (top set −5%), until RPE 9");

    const again = [set(180, 3, 8), set(170, 3, 8)];
    expect(nextTarget(targetsFor(plan, {}, again), again)?.setNumber).toBe(3);

    const ended = [set(180, 3, 8), set(170, 3, 8), set(170, 3, 9)];
    expect(nextTarget(targetsFor(plan, {}, ended), ended)).toBeNull();
  });

  it("a backoff written mid-day hands the remaining sets to the next line once it ends", () => {
    const plan = planDay([
      line({ id: "top", backoff: "repeat until @9 max 3" }),
      line({ id: "pause", setCount: 2, load: "70%", loadKind: "percent" }),
    ])[0];
    const logged = [set(180, 3, 8), set(180, 3, 9)];
    const targets = targetsFor(plan, { training: 200 }, logged);
    expect(targets.map((t) => t.prescriptionId)).toEqual(["top", "top", "pause", "pause"]);
    expect(nextTarget(targets, logged)?.prescriptionId).toBe("pause");
  });

  it("summarises the rule on the line, before and after the top set", () => {
    const plan = squat("3 x 90%");
    expect(lineSummaries(plan, targetsFor(plan, {}))).toEqual(["1 × 3 · RPE 8, then 3 × 3 · 90% of top set"]);
    expect(lineSummaries(plan, targetsFor(plan, {}, [set(180, 3, 8)]))).toEqual([
      "1 × 3 · RPE 8, then 3 × 3 · 160 kg (90% of top set)",
    ]);
    const drop = squat("-5% until @9");
    expect(lineSummaries(drop, targetsFor(drop, {}))).toEqual(["1 × 3 · RPE 8, then sets of 3 · top set −5%, until RPE 9"]);
  });

  it("a line without a rule plans exactly what it did before Order 21", () => {
    const plain = planDay([line({ id: "top", setCount: 2 })])[0];
    const targets = targetsFor(plain, {}, [set(180, 3, 8)]);
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.backoff === undefined)).toBe(true);
  });
});

describe("prefilling a backoff row", () => {
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
  const plan = planDay([line({ id: "top", backoff: "3 x 90%" })])[0];
  const context = (logged: ReturnType<typeof set>[]) => () => ({ logged, targets: targetsFor(plan, {}, logged) });

  it("the row after the top set holds the backoff load, as the coach's number, saying where it came from", () => {
    const logged = [set(185, 3, 8)];
    // The row afterConfirm builds: a repeat of the set just logged.
    const [next] = prescribeNewRows([], [row("r2", { loadKg: 185, reps: 3 })], context(logged));
    expect(next).toMatchObject({
      loadKg: 165,
      reps: 3,
      prescriptionId: "top",
      prescribed: "3 reps · 165 kg (90% of top set)",
      note: "backoff from top set 185 × 3",
    });
    expect(prefillFrom(targetsFor(plan, {}, logged)[1])).toEqual({
      prescription: { loadKg: 165, reps: 3 },
      suggestion: null,
    });
  });

  it("with no top set yet, the row keeps its repeated load and no note -- the rule is shown, not a guess", () => {
    const [next] = prescribeNewRows([], [row("r1"), row("r2", { loadKg: 100, reps: 3 })], context([]));
    expect(next.prescriptionId).toBe("top");
    const second = prescribeNewRows([], [row("r1"), row("r2", { loadKg: 100, reps: 3 })], context([]))[1];
    expect(second).toMatchObject({ loadKg: 100, prescribed: "3 reps · 90% of top set" });
    expect(second.note ?? null).toBeNull();
  });

  it("never re-prices a row already on screen", () => {
    const typed = row("r2", { loadKg: 150, reps: 3 });
    expect(prescribeNewRows([typed], [typed], context([set(185, 3, 8)]))[0]).toEqual(typed);
  });
});

describe("the write boundary", () => {
  it("accepts a valid backoff on add and update, and an empty one as clearing it", () => {
    expect(readProgramOp({ op: "addPrescription", dayId: "d1", exerciseId: "e1", setCount: 1, backoff: "3 x 90%" }).ok).toBe(true);
    const cleared = readProgramOp({ op: "updatePrescription", prescriptionId: "l1", backoff: "" });
    expect(cleared.ok && cleared.op.op === "updatePrescription" && cleared.op.backoff).toBeNull();
  });

  it("refuses a backoff that cannot be executed, in the editor's words", () => {
    const refused = readProgramOp({ op: "updatePrescription", prescriptionId: "l1", backoff: "3 x 110%" });
    expect(refused).toEqual({ ok: false, reason: expect.stringContaining("backoff:") });
  });
});

describe("the editor's backoff cell", () => {
  const base = () => line({ id: "l1", backoff: null });

  it("sits after notes, so Order 30's video column can follow it", () => {
    expect(COLUMNS.slice(-2)).toEqual(["notes", "backoff"]);
  });

  it("saves what was typed in its canonical spelling", () => {
    expect(commitCell(base(), "backoff", "-10%x3")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", backoff: "3 x 90%" },
    });
  });

  it("refuses a rule it cannot execute on the cell, never as a toast", () => {
    expect(commitCell(base(), "backoff", "drop a bit")).toEqual({ error: expect.stringContaining("Backoff is like") });
    expect(commitCell(base(), "backoff", "3 x 110%")).toEqual({ error: expect.stringContaining("at most 100%") });
  });

  it("writes nothing when the rule did not change, however it was respaced", () => {
    const withRule = line({ id: "l1", backoff: "3 x 90%" });
    expect(commitCell(withRule, "backoff", cellText(withRule, "backoff"))).toEqual({ unchanged: true });
    expect(commitCell(withRule, "backoff", "3x90%")).toEqual({ unchanged: true });
  });

  it("clears to no backoff when emptied, and shows the save before the server answers", () => {
    const withRule = line({ id: "l1", backoff: "3 x 90%" });
    const result = commitCell(withRule, "backoff", "");
    expect(result).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", backoff: null } });
    if ("op" in result) expect(applyLineOp(withRule, result.op).backoff).toBeNull();
    expect(applyLineOp(base(), { op: "updatePrescription", prescriptionId: "l1", backoff: "3 x 90%" }).backoff).toBe("3 x 90%");
  });

  it("says what the rule will do beside the cell", () => {
    expect(describeBackoffCell("3 x 90%")).toBe("3 sets at 90% of today's top set");
    expect(describeBackoffCell("")).toBe("No backoff");
  });
});
