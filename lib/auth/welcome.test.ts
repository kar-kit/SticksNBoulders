import { readWelcome } from "./welcome";

describe("reading the welcome form", () => {
  it("refuses to carry on without a choice", () => {
    expect(readWelcome(null, "Joey Pang", "Joey Pang")).toEqual({
      ok: false,
      message: "Choose coach or athlete to carry on.",
    });
  });

  it("refuses an empty name with the profile screen's own words", () => {
    expect(readWelcome("athlete", "   ", "Joey")).toEqual({
      ok: false,
      message: "Your coach needs something to call you.",
    });
  });

  it("refuses a name longer than the column holds", () => {
    const result = readWelcome("coach", "x".repeat(70), "Joey");
    expect(result.ok).toBe(false);
  });

  it("does not count an untouched pre-fill as an edit, so it cannot rename an existing profile", () => {
    expect(readWelcome("coach", "Joey Pang", "Joey Pang")).toEqual({
      ok: true,
      mode: "coach",
      name: "Joey Pang",
      edited: false,
    });
  });

  it("does not count whitespace as an edit", () => {
    expect(readWelcome("athlete", "  Joey   Pang ", "Joey Pang")).toMatchObject({ name: "Joey Pang", edited: false });
  });

  it("counts a changed name as an edit", () => {
    expect(readWelcome("athlete", "Joey P", "joey")).toMatchObject({ ok: true, name: "Joey P", edited: true });
  });

  it("counts any name as an edit when there was nothing to start from", () => {
    expect(readWelcome("athlete", "Joey", "")).toMatchObject({ ok: true, edited: true });
  });
});
