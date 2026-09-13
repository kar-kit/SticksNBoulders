import { generateCode, CODE_ALPHABET } from "../code-generator.js";

describe("generateCode", () => {
  it("defaults to 8 characters long", () => {
    expect(generateCode()).toHaveLength(8);
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
});
