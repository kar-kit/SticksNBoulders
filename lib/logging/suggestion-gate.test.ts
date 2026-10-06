import { nextSetSuggestion } from "./suggestion-gate";

// 170 x 5 @ RPE 7 is eight reps from failure; 5 @ RPE 8 is seven. The ratio
// lands on 175.9, rounded down to 175 -- the same worked example as
// docs/suggestions.md.
const logged = { loadKg: 170, reps: 5, rpe: 7, isWarmup: false };
const target = { reps: 5, rpe: 8 as const };

describe("the coach's gate on next-set suggestions", () => {
  it("lets the engine's answer through when the coach chose direct", () => {
    expect(nextSetSuggestion("direct", logged, target)).toEqual({
      loadKg: 175,
      reps: 5,
      fromRpe: 7,
      fromLoadKg: 170,
    });
  });

  it("lets nothing through when the coach holds them, whatever the engine would say", () => {
    expect(nextSetSuggestion("held", logged, target)).toBeNull();
  });

  it("suggests nothing without a target, in either mode: there is no default target", () => {
    expect(nextSetSuggestion("direct", logged, null)).toBeNull();
    expect(nextSetSuggestion("held", logged, null)).toBeNull();
  });

  it("still applies every refusal the engine makes", () => {
    expect(nextSetSuggestion("direct", { ...logged, rpe: null }, target)).toBeNull();
    expect(nextSetSuggestion("direct", { ...logged, isWarmup: true }, target)).toBeNull();
  });
});
