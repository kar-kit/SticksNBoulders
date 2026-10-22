import {
  forgetRememberedExerciseHistory,
  recallExerciseHistory,
  rememberExerciseHistory,
} from "./exercise-history-cache";

const squat = {
  previous: [
    { loadKg: 60, reps: 5, isWarmup: true },
    { loadKg: 140, reps: 5, isWarmup: false },
  ],
  bests: {
    e1rmKg: 170,
    heaviestKg: 150,
    repsAt: [
      { loadKg: 150, reps: 2 },
      { loadKg: 140, reps: 5 },
    ],
  },
};

beforeEach(() => localStorage.clear());

describe("exercise history, remembered for the session", () => {
  it("gives back what was kept, for the same athlete and session", () => {
    rememberExerciseHistory("ath", "ses", "squat", squat);
    expect(recallExerciseHistory("ath", "ses", "squat")).toEqual(squat);
  });

  it("keeps several exercises side by side", () => {
    rememberExerciseHistory("ath", "ses", "squat", squat);
    rememberExerciseHistory("ath", "ses", "bench", { previous: [], bests: null });
    expect(recallExerciseHistory("ath", "ses", "squat")).toEqual(squat);
    expect(recallExerciseHistory("ath", "ses", "bench")).toEqual({ previous: [], bests: null });
  });

  it("is nothing to another session or another athlete", () => {
    rememberExerciseHistory("ath", "ses", "squat", squat);
    expect(recallExerciseHistory("ath", "other", "squat")).toBeNull();
    expect(recallExerciseHistory("someone", "ses", "squat")).toBeNull();
  });

  it("starts again for a new session rather than keeping the last one's", () => {
    rememberExerciseHistory("ath", "old", "squat", squat);
    rememberExerciseHistory("ath", "new", "bench", { previous: [], bests: null });
    expect(recallExerciseHistory("ath", "old", "squat")).toBeNull();
    expect(recallExerciseHistory("ath", "new", "squat")).toBeNull();
  });

  it("ignores a copy that does not parse", () => {
    localStorage.setItem(
      "snb.exercise-history",
      JSON.stringify({
        athleteId: "ath",
        sessionId: "ses",
        exercises: {
          squat: { previous: [{ loadKg: "140", reps: 5, isWarmup: false }], bests: null },
          bench: { previous: [], bests: { e1rmKg: "a lot", heaviestKg: null } },
          row: { previous: [] },
        },
      }),
    );
    expect(recallExerciseHistory("ath", "ses", "squat")).toBeNull();
    expect(recallExerciseHistory("ath", "ses", "bench")).toBeNull();
    expect(recallExerciseHistory("ath", "ses", "row")).toBeNull();
    localStorage.setItem("snb.exercise-history", "{not json");
    expect(recallExerciseHistory("ath", "ses", "squat")).toBeNull();
  });

  it("reads a copy kept before rep records as having no rep frontier", () => {
    localStorage.setItem(
      "snb.exercise-history",
      JSON.stringify({
        athleteId: "ath",
        sessionId: "ses",
        exercises: { squat: { previous: [], bests: { e1rmKg: 170, heaviestKg: 150 } } },
      }),
    );
    expect(recallExerciseHistory("ath", "ses", "squat")?.bests).toEqual({ e1rmKg: 170, heaviestKg: 150, repsAt: null });
  });

  it("ignores a rep frontier that does not parse", () => {
    localStorage.setItem(
      "snb.exercise-history",
      JSON.stringify({
        athleteId: "ath",
        sessionId: "ses",
        exercises: {
          squat: { previous: [], bests: { e1rmKg: 170, heaviestKg: 150, repsAt: [{ loadKg: 140, reps: "5" }] } },
          bench: { previous: [], bests: { e1rmKg: 170, heaviestKg: 150, repsAt: "lots" } },
        },
      }),
    );
    expect(recallExerciseHistory("ath", "ses", "squat")).toBeNull();
    expect(recallExerciseHistory("ath", "ses", "bench")).toBeNull();
  });

  it("forgets", () => {
    rememberExerciseHistory("ath", "ses", "squat", squat);
    forgetRememberedExerciseHistory();
    expect(recallExerciseHistory("ath", "ses", "squat")).toBeNull();
  });
});
