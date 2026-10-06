import {
  DEFAULT_SUGGESTION_MODE,
  UNKNOWN_SUGGESTION_MODE,
  isSuggestionMode,
  modeForAthlete,
  parseSuggestionMode,
} from "./suggestion-mode";

describe("suggestion mode", () => {
  it("defaults to direct for a link written before Order 28", () => {
    expect(DEFAULT_SUGGESTION_MODE).toBe("direct");
    expect(parseSuggestionMode(undefined)).toBe("direct");
    expect(parseSuggestionMode(null)).toBe("direct");
    expect(parseSuggestionMode("approve")).toBe("direct");
    expect(parseSuggestionMode("held")).toBe("held");
  });

  it("assumes held on a device that has never been told", () => {
    expect(UNKNOWN_SUGGESTION_MODE).toBe("held");
  });

  it("knows exactly two modes", () => {
    expect(isSuggestionMode("direct")).toBe(true);
    expect(isSuggestionMode("held")).toBe(true);
    expect(isSuggestionMode("gated")).toBe(false);
    expect(isSuggestionMode(1)).toBe(false);
  });

  it("is direct for an athlete with no coach", () => {
    expect(modeForAthlete([])).toBe("direct");
  });

  it("follows the coach's choice", () => {
    expect(modeForAthlete([{ suggestionsMode: "held" }])).toBe("held");
    expect(modeForAthlete([{ suggestionsMode: "direct" }])).toBe("direct");
    expect(modeForAthlete([{ suggestionsMode: null }])).toBe("direct");
  });

  it("holds if any active coach holds", () => {
    expect(modeForAthlete([{ suggestionsMode: "direct" }, { suggestionsMode: "held" }])).toBe("held");
  });
});
