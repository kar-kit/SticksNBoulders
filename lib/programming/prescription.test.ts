import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASIS,
  LOADABLE_INCREMENT_KG,
  formatPrescription,
  parsePrescription,
  readPrescription,
  resolveExercise,
  resolvePrescription,
  sessionMaxFrom,
  roundToLoadable,
  toPrefillPrescription,
  type PrescriptionSpec,
} from "./prescription";

const parse = (text: string) => parsePrescription(text);

describe("an empty cell", () => {
  it("is the absence of a prescription, not a prescription of nothing", () => {
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
    expect(readPrescription("")).toBeNull();
  });
});

describe("fixed loads", () => {
  it("reads a bare number as kilos", () => {
    expect(parse("142.5")).toEqual({ kind: "fixed", loadKg: 142.5 });
  });

  /** The blueprint's own grid has a `60 kg` cell. */
  it("accepts a trailing kg, spaced or not", () => {
    expect(parse("60 kg")).toEqual({ kind: "fixed", loadKg: 60 });
    expect(parse("60kg")).toEqual({ kind: "fixed", loadKg: 60 });
    expect(parse("60KG")).toEqual({ kind: "fixed", loadKg: 60 });
  });

  /**
   * Deliberate, and worth stating because it will look like a bug: the grammar
   * requires @ or "rpe" for an RPE, so a coach typing 8 gets 8kg. The editor
   * shows which kind it parsed as, which is what makes this visible rather
   * than silent.
   */
  it("reads a bare 8 as 8kg, not as RPE 8", () => {
    expect(parse("8")).toEqual({ kind: "fixed", loadKg: 8 });
  });

  it("refuses zero and negatives, which fall through to freeform", () => {
    expect(parse("0")).toMatchObject({ kind: "freeform" });
    expect(parse("-20")).toMatchObject({ kind: "freeform" });
  });
});

describe("percentages", () => {
  it("reads a percentage against the training max by default", () => {
    expect(parse("75%")).toEqual({ kind: "percent", percent: 75, basis: "training" });
    expect(DEFAULT_BASIS).toBe("training");
  });

  it("tolerates a space before the sign", () => {
    expect(parse("75 %")).toMatchObject({ kind: "percent", percent: 75 });
  });

  it("takes a fractional percentage", () => {
    expect(parse("72.5%")).toMatchObject({ percent: 72.5 });
  });

  /** The blueprint's grid cell reads "75% of training max". */
  it("reads the basis the blueprint spells out", () => {
    expect(parse("75% of training max")).toMatchObject({ basis: "training" });
    expect(parse("75% of tested")).toMatchObject({ basis: "tested" });
    expect(parse("75% of e1rm")).toMatchObject({ basis: "estimated" });
  });
});

describe("RPE", () => {
  it("reads both spellings the blueprint gives", () => {
    expect(parse("@8")).toEqual({ kind: "rpe", rpe: 8 });
    expect(parse("rpe8")).toEqual({ kind: "rpe", rpe: 8 });
    expect(parse("rpe 8")).toEqual({ kind: "rpe", rpe: 8 });
    expect(parse("RPE8")).toEqual({ kind: "rpe", rpe: 8 });
  });

  it("takes half points, which is how RPE is logged", () => {
    expect(parse("@8.5")).toEqual({ kind: "rpe", rpe: 8.5 });
  });

  /**
   * Out of range is not an error to reject. It falls through to freeform, so
   * "@12" reaches the athlete as the coach's own words rather than as a
   * silently clamped RPE 10.
   */
  it("does not clamp an out-of-range value, it keeps the coach's words", () => {
    expect(parse("@12")).toEqual({ kind: "freeform", text: "@12" });
    expect(parse("@5")).toEqual({ kind: "freeform", text: "@5" });
    expect(parse("@8.25")).toMatchObject({ kind: "freeform" });
  });
});

describe("capped", () => {
  it("is its own kind, not a percentage that mentions an RPE", () => {
    expect(parse("75% @8")).toEqual({
      kind: "capped",
      percent: 75,
      basis: "training",
      rpe: 8,
    });
  });

  it("does not care which order they were typed in", () => {
    expect(parse("@8 75%")).toEqual(parse("75% @8"));
  });

  it("takes the rpe spelling too", () => {
    expect(parse("75% rpe8")).toMatchObject({ kind: "capped", rpe: 8 });
  });

  it("keeps a non-default basis alongside the cap", () => {
    expect(parse("75% of tested @8")).toMatchObject({ basis: "tested", rpe: 8 });
  });
});

describe("freeform, the escape hatch", () => {
  it("keeps anything the grammar does not recognise, exactly as typed", () => {
    expect(parse("work up to a heavy single")).toEqual({
      kind: "freeform",
      text: "work up to a heavy single",
    });
  });

  /**
   * The failure mode worth naming: a typo becomes text rather than a resolved
   * load. Parsing must not reject it -- freeform is the escape hatch -- so the
   * spec carries its kind and the editor shows the coach what it landed as.
   */
  it("catches a mistyped percentage rather than guessing at it", () => {
    expect(parse("75%%")).toMatchObject({ kind: "freeform", text: "75%%" });
  });

  /** Words left over mean the coach said something the grammar dropped. */
  it("does not silently discard an instruction wrapped around a number", () => {
    expect(parse("75% then stretch")).toEqual({ kind: "freeform", text: "75% then stretch" });
    expect(parse("squat 142.5")).toMatchObject({ kind: "freeform" });
  });

  /**
   * The regexes are non-global, so they see only the first percentage and the
   * first RPE. Everything here would be a silent drop -- a coach typing two
   * percentages getting one of them on the bar -- if the whole-cell check were
   * not there. It is the guard that makes the grammar safe to keep loose, so
   * these are pinned rather than left to the happy path.
   */
  it.each([
    "75% 80%",
    "80% 75%",
    "@8 @9",
    "75% @8 @9",
    "75% of tested 75%",
    "3x8 @8",
    "5x5 60kg",
  ])("keeps %s whole instead of parsing the first token and dropping the rest", (text) => {
    expect(parse(text)).toEqual({ kind: "freeform", text });
  });

  /** An RPE spelling embedded in a sentence must not escape the sentence. */
  it.each(["work up to rpe 8", "work up to a heavy single @ 8 sets", "rperformance 8"])(
    "does not find a prescription inside %s",
    (text) => {
      expect(parse(text)).toEqual({ kind: "freeform", text });
    },
  );
});

describe("format and parse are inverses", () => {
  const specs: PrescriptionSpec[] = [
    { kind: "fixed", loadKg: 142.5 },
    { kind: "fixed", loadKg: 60 },
    { kind: "percent", percent: 75, basis: "training" },
    { kind: "percent", percent: 72.5, basis: "tested" },
    { kind: "percent", percent: 80, basis: "estimated" },
    { kind: "rpe", rpe: 8 },
    { kind: "rpe", rpe: 9.5 },
    { kind: "capped", percent: 75, basis: "training", rpe: 8 },
    { kind: "capped", percent: 65, basis: "tested", rpe: 9.5 },
    { kind: "freeform", text: "work up to a heavy single" },
  ];

  /**
   * The invariant that lets Order 19 store either the typed text or the
   * structured fields and derive the other, so that choice can wait for the
   * table it belongs to.
   */
  it.each(specs)("round-trips %j", (spec) => {
    expect(parsePrescription(formatPrescription(spec))).toEqual(spec);
  });

  it("normalises a spelling to its canonical form", () => {
    expect(formatPrescription(parse("rpe 8")!)).toBe("@8");
    expect(formatPrescription(parse("60 kg")!)).toBe("60kg");
    expect(formatPrescription(parse("@8 75%")!)).toBe("75% @8");
  });
});

describe("rounding to something loadable", () => {
  it("lands on a plate pair", () => {
    expect(LOADABLE_INCREMENT_KG).toBe(2.5);
    expect(roundToLoadable(133.225)).toBe(132.5);
    expect(roundToLoadable(142.5)).toBe(142.5);
  });

  /**
   * Down rather than to nearest, deliberately. Prescribing more than the coach
   * asked for is a failed set; prescribing a shade less is a set that was
   * light. Rounding to nearest would also make 100% of a 191.5kg max resolve
   * to 192.5 -- a weight the athlete has never lifted.
   */
  it("never rounds up past what was asked for", () => {
    expect(roundToLoadable(141.4)).toBe(140);
    expect(roundToLoadable(144.9)).toBe(142.5);
    expect(roundToLoadable(191.5)).toBe(190);
  });
});

describe("resolving against a max", () => {
  const maxes = { training: 180, tested: 195, estimated: 191.5 };

  it("puts kilos on the bar for a percentage", () => {
    const resolved = resolvePrescription(parse("75%")!, maxes);
    // 75% of 180 = 135, already loadable.
    expect(resolved.loadKg).toBe(135);
    expect(resolved.unresolved).toBe(false);
    expect(resolved.display).toBe("135 kg (75%)");
  });

  it("uses the basis the prescription names", () => {
    expect(resolvePrescription(parse("100% of tested")!, maxes).loadKg).toBe(195);
    // 191.5 is not loadable, and rounding down keeps the prescription at or
    // under the max rather than above a weight never lifted.
    expect(resolvePrescription(parse("100% of e1rm")!, maxes).loadKg).toBe(190);
  });

  it("rounds a percentage to a weight that can be loaded", () => {
    // 73% of 182.5 = 133.225
    expect(resolvePrescription(parse("73%")!, { training: 182.5 }).loadKg).toBe(132.5);
  });

  /**
   * The honest failure. Inventing a number here would put a weight on a bar
   * that no coach chose and no data supports, so the athlete sees the
   * percentage and uses their judgement -- and prefill's contract already
   * documents a null load for exactly this case.
   */
  it("resolves to no load when the athlete has no max yet", () => {
    const resolved = resolvePrescription(parse("75%")!, {});
    expect(resolved.loadKg).toBeNull();
    expect(resolved.unresolved).toBe(true);
    expect(resolved.display).toBe("75%");
  });

  it("treats a zero or missing basis as no max rather than as zero kilos", () => {
    expect(resolvePrescription(parse("75%")!, { training: 0 }).loadKg).toBeNull();
    expect(resolvePrescription(parse("75% of tested")!, { training: 180 }).loadKg).toBeNull();
  });

  it("hands an RPE prescription straight to the athlete", () => {
    const resolved = resolvePrescription(parse("@8")!, maxes);
    expect(resolved).toMatchObject({ loadKg: null, rpe: 8, display: "RPE 8", unresolved: false });
  });

  it("carries both the load and the ceiling for a capped one", () => {
    const resolved = resolvePrescription(parse("75% @8")!, maxes);
    expect(resolved.loadKg).toBe(135);
    expect(resolved.rpe).toBe(8);
    expect(resolved.display).toBe("135 kg (75%), stop at RPE 8");
  });

  it("keeps the ceiling even when the percentage cannot resolve", () => {
    // The cap is still a real instruction without a max to resolve against.
    const resolved = resolvePrescription(parse("75% @8")!, {});
    expect(resolved).toMatchObject({ loadKg: null, rpe: 8, unresolved: true });
    expect(resolved.display).toBe("75%, stop at RPE 8");
  });

  it("shows freeform exactly as written", () => {
    expect(resolvePrescription(parse("work up to a heavy single")!, maxes)).toMatchObject({
      loadKg: null,
      display: "work up to a heavy single",
    });
  });

  it("reads raw text end to end", () => {
    expect(readPrescription("75% @8", maxes)).toMatchObject({ loadKg: 135, rpe: 8 });
  });
});

describe("handing off to the logger", () => {
  it("gives prefill a load it can use", () => {
    const resolved = resolvePrescription(parse("75%")!, { training: 180 });
    expect(toPrefillPrescription(resolved, 5)).toEqual({ loadKg: 135, reps: 5 });
  });

  /**
   * prefill's own contract documents this case: the kilo field starts empty
   * and the RPE engine fills it after the first working set.
   */
  it("gives it a null load when there is nothing to resolve against", () => {
    expect(toPrefillPrescription(resolvePrescription(parse("75%")!, {}), 5)).toEqual({
      loadKg: null,
      reps: 5,
    });
    expect(toPrefillPrescription(resolvePrescription(parse("@8")!), 3)).toEqual({
      loadKg: null,
      reps: 3,
    });
  });
});

describe("syncing percentages to today's first set", () => {
  const stored = { training: 180 };
  /** 5 @ RPE 8 with 170 on the bar: reps-to-failure 7, e1RM 204. */
  const firstSet = { loadKg: 170, reps: 5, rpe: 8 };

  it("derives today's working max from the set the athlete just did", () => {
    expect(sessionMaxFrom(firstSet)).toBe(204);
  });

  it("refuses a warm-up, a set with no RPE, or one too far from failure", () => {
    expect(sessionMaxFrom({ ...firstSet, isWarmup: true })).toBeNull();
    expect(sessionMaxFrom({ ...firstSet, rpe: null })).toBeNull();
    expect(sessionMaxFrom({ loadKg: 60, reps: 20, rpe: 8 })).toBeNull();
  });

  /**
   * The point of the whole percentage model. A stored training max is a number
   * from weeks ago; the first working set is a measurement from minutes ago,
   * and it is what the remaining sets should be priced against.
   */
  it("prices the rest of the exercise off the first set, not the stored max", () => {
    const resolved = resolvePrescription(parse("75%")!, { ...stored, session: 204 });
    // 75% of 204 = 153, not 75% of 180 = 135.
    expect(resolved.loadKg).toBe(152.5);
    expect(resolved.basisUsed).toBe("session");
    expect(resolved.synced).toBe(true);
  });

  it("falls back to the stored max before the first set is logged", () => {
    const resolved = resolvePrescription(parse("75%")!, stored);
    expect(resolved.loadKg).toBe(135);
    expect(resolved.basisUsed).toBe("training");
    expect(resolved.synced).toBe(false);
  });

  /** A coach naming a specific stored number gets it. The escape hatch is a word. */
  it("does not autoregulate a basis the coach spelled out", () => {
    const maxes = { training: 180, tested: 195, session: 204 };
    const resolved = resolvePrescription(parse("100% of tested")!, maxes);
    expect(resolved.loadKg).toBe(195);
    expect(resolved.basisUsed).toBe("tested");
    expect(resolved.synced).toBe(false);
  });

  it("resolves a whole exercise from its first set in one go", () => {
    const specs = [
      parse("@8")!,
      parse("75%")!,
      parse("70%")!,
      parse("70%")!,
    ];
    const resolved = resolveExercise(specs, stored, firstSet);

    // The top set stays an RPE -- the athlete picks it, and it is what
    // establishes the max the rest are priced off.
    expect(resolved[0]).toMatchObject({ rpe: 8, loadKg: null });
    // 75% and 70% of 204, rounded down to a loadable weight.
    expect(resolved.slice(1).map((r) => r.loadKg)).toEqual([152.5, 142.5, 142.5]);
    expect(resolved.slice(1).every((r) => r.synced)).toBe(true);
  });

  it("opens the session on stored numbers rather than on blanks", () => {
    const resolved = resolveExercise([parse("@8")!, parse("75%")!], stored, null);
    expect(resolved[1].loadKg).toBe(135);
    expect(resolved[1].synced).toBe(false);
  });

  /** A warm-up first must not re-price the working sets off a warm-up. */
  it("ignores a first set that cannot honestly produce a max", () => {
    const resolved = resolveExercise([parse("75%")!], stored, { ...firstSet, isWarmup: true });
    expect(resolved[0].loadKg).toBe(135);
    expect(resolved[0].synced).toBe(false);
  });

  it("still resolves nothing when there is no max from either source", () => {
    const resolved = resolveExercise([parse("75%")!], {}, { ...firstSet, rpe: null });
    expect(resolved[0]).toMatchObject({ loadKg: null, unresolved: true, synced: false });
  });
});
