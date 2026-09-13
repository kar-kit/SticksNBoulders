import { kgToLb, lbToKg, displayWeight, toKg, formatWeight } from "../units";

describe("kgToLb / lbToKg", () => {
  it("converts kg to lb using the standard factor", () => {
    expect(kgToLb(1)).toBeCloseTo(2.20462, 4);
    expect(kgToLb(100)).toBeCloseTo(220.462, 2);
  });

  it("converts lb to kg using the standard factor", () => {
    expect(lbToKg(1)).toBeCloseTo(0.453592, 5);
    expect(lbToKg(220.462)).toBeCloseTo(100, 1);
  });

  it("round-trips kg -> lb -> kg back to the original value", () => {
    expect(lbToKg(kgToLb(83.5))).toBeCloseTo(83.5, 8);
  });

  it("handles zero", () => {
    expect(kgToLb(0)).toBe(0);
    expect(lbToKg(0)).toBe(0);
  });
});

describe("displayWeight", () => {
  it("passes kg through unrounded-input as-is when already at 1 decimal", () => {
    expect(displayWeight(100, "kg")).toBe(100);
    expect(displayWeight(82.5, "kg")).toBe(82.5);
  });

  it("rounds kg to 1 decimal place", () => {
    expect(displayWeight(82.549, "kg")).toBe(82.5);
    expect(displayWeight(82.551, "kg")).toBe(82.6);
  });

  it("converts to lb and rounds to 1 decimal", () => {
    expect(displayWeight(100, "lb")).toBeCloseTo(220.5, 1);
  });

  it("handles 0kg", () => {
    expect(displayWeight(0, "kg")).toBe(0);
    expect(displayWeight(0, "lb")).toBe(0);
  });
});

describe("toKg", () => {
  it("passes kg input straight through", () => {
    expect(toKg(100, "kg")).toBe(100);
  });

  it("converts lb input to kg", () => {
    expect(toKg(220.462, "lb")).toBeCloseTo(100, 1);
  });

  it("round-trips through displayWeight/toKg for a lb-preferring user", () => {
    const storedKg = 102.058;
    const shown = displayWeight(storedKg, "lb");
    const backToKg = toKg(shown, "lb");
    // Rounding to 1 display decimal means this is approximate, not exact.
    expect(backToKg).toBeCloseTo(storedKg, 0);
  });
});

describe("formatWeight", () => {
  it("formats kg with a unit suffix", () => {
    expect(formatWeight(100, "kg")).toBe("100 kg");
  });

  it("formats lb with a unit suffix and converted value", () => {
    expect(formatWeight(100, "lb")).toBe("220.5 lb");
  });

  it("formats zero correctly", () => {
    expect(formatWeight(0, "kg")).toBe("0 kg");
  });
});
