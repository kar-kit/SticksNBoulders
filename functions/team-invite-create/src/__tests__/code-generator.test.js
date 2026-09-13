import { generateCode, CODE_ALPHABET } from "../code-generator.js";

describe("generateCode", () => {
  it("defaults to 8 characters long", () => {
    expect(generateCode()).toHaveLength(8);
  });

  it("supports a custom length", () => {
    expect(generateCode(4)).toHaveLength(4);
    expect(generateCode(12)).toHaveLength(12);
  });

  it("only uses characters from the unambiguous alphabet", () => {
    const code = generateCode(200);
    for (const char of code) {
      expect(CODE_ALPHABET).toContain(char);
    }
  });

  it("excludes visually ambiguous characters (0, O, 1, I, L)", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it("produces different codes across calls (not a fixed/seeded value)", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });

  it("returns an empty string for a length of 0", () => {
    expect(generateCode(0)).toBe("");
  });
});
