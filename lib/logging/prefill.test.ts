import { formatNumber, resolvePrefill } from "./prefill";
import { loadFromInput } from "@/lib/units";

const prescription = { loadKg: 142.5, reps: 5 };
const suggestion = { loadKg: 150, fromRpe: 7, fromLoadKg: 142.5 };
const previous = { loadKg: 145, reps: 5 };
const lastSession = { loadKg: 140, reps: 3 };

describe("resolvePrefill precedence", () => {
  it("takes a prescription with a resolvable load over everything else", () => {
    const result = resolvePrefill({
      prescription,
      suggestion,
      previousSetThisSession: previous,
      sameExerciseLastSession: lastSession,
    });
    expect(result).toMatchObject({ loadKg: 142.5, reps: 5, source: "prescribed", note: null });
  });

  it("falls to the suggestion when the prescription has no resolvable load", () => {
    // "3 x 5 @ RPE 8" -- the reps are known, the kilos are not.
    const result = resolvePrefill({
      prescription: { loadKg: null, reps: 5 },
      suggestion,
      previousSetThisSession: previous,
    });
    expect(result.source).toBe("suggested");
    expect(result.loadKg).toBe(150);
  });

  it("keeps the prescribed reps even when its load is unresolvable", () => {
    // The coach wrote 5. Making the athlete retype it because the load is
    // RPE-based would be the app losing information it already has.
    const result = resolvePrefill({
      prescription: { loadKg: null, reps: 5 },
      previousSetThisSession: { loadKg: 145, reps: 8 },
    });
    expect(result.reps).toBe(5);
    expect(result.loadKg).toBe(145);
    expect(result.source).toBe("repeated");
  });

  it("repeats the previous set of this session when there is no prescription or suggestion", () => {
    // Rule 3, the one that matters most: straight sets are the norm.
    const result = resolvePrefill({
      previousSetThisSession: previous,
      sameExerciseLastSession: lastSession,
    });
    expect(result).toMatchObject({ loadKg: 145, reps: 5, source: "repeated", note: null });
  });

  it("falls back to the same exercise last session", () => {
    const result = resolvePrefill({ sameExerciseLastSession: lastSession });
    expect(result).toMatchObject({ loadKg: 140, reps: 3, source: "last-session" });
    expect(result.note).toBe("from your last session");
  });

  it("returns empty when nothing is known", () => {
    expect(resolvePrefill()).toEqual({ loadKg: null, reps: null, source: "empty", note: null });
    expect(resolvePrefill({})).toEqual({ loadKg: null, reps: null, source: "empty", note: null });
  });
});

describe("resolvePrefill annotations", () => {
  it("explains a suggested load with the RPE and load it came from", () => {
    const result = resolvePrefill({ suggestion });
    expect(result.note).toBe("suggested from RPE 7 @ 142.5");
  });

  it("carries no note for a prescription or a repeat, which need no explaining", () => {
    expect(resolvePrefill({ prescription }).note).toBeNull();
    expect(resolvePrefill({ previousSetThisSession: previous }).note).toBeNull();
  });

  it("renders a half-point RPE in the note without trailing noise", () => {
    const result = resolvePrefill({
      suggestion: { loadKg: 155, fromRpe: 8.5, fromLoadKg: 147.5 },
    });
    expect(result.note).toBe("suggested from RPE 8.5 @ 147.5");
  });
});

describe("resolvePrefill input hygiene", () => {
  it.each([0, -50, Number.NaN, Number.POSITIVE_INFINITY])(
    "skips a prescription load of %p rather than prefilling it",
    (loadKg) => {
      const result = resolvePrefill({
        prescription: { loadKg, reps: 5 },
        previousSetThisSession: previous,
      });
      expect(result.source).toBe("repeated");
      expect(result.loadKg).toBe(145);
    },
  );

  it.each([0, -3, 2.5])("skips a reps value of %p", (reps) => {
    const result = resolvePrefill({
      prescription: { loadKg: 142.5, reps },
      previousSetThisSession: previous,
    });
    expect(result.reps).toBe(5);
  });

  it("treats explicit nulls the same as absent sources", () => {
    expect(
      resolvePrefill({
        prescription: null,
        suggestion: null,
        previousSetThisSession: null,
        sameExerciseLastSession: null,
      }).source,
    ).toBe("empty");
  });

  it("does not invent a load from a source that only knows reps", () => {
    const result = resolvePrefill({ prescription: { loadKg: null, reps: 5 } });
    expect(result.loadKg).toBeNull();
    expect(result.reps).toBe(5);
    expect(result.source).toBe("empty");
  });
});

describe("formatNumber", () => {
  it("keeps a genuine half-kilo plate", () => {
    expect(formatNumber(142.5)).toBe("142.5");
  });

  it("does not render a whole number with a decimal tail", () => {
    expect(formatNumber(145)).toBe("145");
    expect(formatNumber(145.0)).toBe("145");
  });

  it("trims floating-point noise rather than showing it to a lifter", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
  });
});

describe("the suggestion note for an athlete who reads pounds", () => {
  it("names the set it came from in pounds, so 315 never reads as 142.9", () => {
    const fromLoadKg = loadFromInput(315, "lb");
    const prefill = resolvePrefill({ unit: "lb", suggestion: { loadKg: 145, fromRpe: 7, fromLoadKg } });
    expect(prefill.note).toBe("suggested from RPE 7 @ 315");
    // The load itself is still the stored kilos; the row converts it.
    expect(prefill.loadKg).toBe(145);
  });

  it("is in kilos by default", () => {
    expect(resolvePrefill({ suggestion }).note).toBe("suggested from RPE 7 @ 142.5");
  });
});

describe("a bodyweight set at 0 kg (F20)", () => {
  it("is repeated by rule 3, so the next pull-up at bodyweight is one tap", () => {
    expect(resolvePrefill({ previousSetThisSession: { loadKg: 0, reps: 10 } })).toEqual({
      loadKg: 0,
      reps: 10,
      source: "repeated",
      note: null,
    });
  });

  it("is carried from last session by rule 4", () => {
    expect(resolvePrefill({ sameExerciseLastSession: { loadKg: 0, reps: 8 } })).toMatchObject({
      loadKg: 0,
      reps: 8,
      source: "last-session",
    });
  });

  it("is never taken from a prescription or a suggestion, which mean nothing at 0 kg", () => {
    const fromRules = resolvePrefill({
      prescription: { loadKg: 0, reps: 5 },
      suggestion: { loadKg: 0, fromRpe: 7, fromLoadKg: 0 },
      sameExerciseLastSession: { loadKg: 20, reps: 5 },
    });
    expect(fromRules).toMatchObject({ loadKg: 20, source: "last-session" });
  });

  it("still skips loads that are not loads", () => {
    for (const loadKg of [-5, Number.NaN]) {
      expect(resolvePrefill({ previousSetThisSession: { loadKg, reps: 10 } }).source).toBe("empty");
    }
  });
});
