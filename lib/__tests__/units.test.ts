import {
  kgToLb,
  lbToKg,
  displayWeight,
  toKg,
  formatWeight,
  loadFromInput,
  loadIn,
  loadLabel,
  loadNumber,
  unitName,
} from "../units";

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

describe("loadIn / loadFromInput: the two boundaries a load crosses", () => {
  it("leaves kilos exactly as typed, both ways", () => {
    expect(loadFromInput(142.5, "kg")).toBe(142.5);
    expect(loadFromInput(142.25, "kg")).toBe(142.25);
    expect(loadIn(142.25, "kg")).toBe(142.25);
    expect(loadIn(168.00000000000003, "kg")).toBe(168);
  });

  it("stores 225 lb as its kilos, not as 225 kg", () => {
    expect(loadFromInput(225, "lb")).toBe(102.058);
  });

  it("reads stored kilos back in pounds, to one decimal", () => {
    expect(loadIn(100, "lb")).toBe(220.5);
    expect(loadIn(102.058, "lb")).toBe(225);
  });

  it("reads back every pound value the pad accepts exactly as it was typed", () => {
    // The pad takes one decimal in pounds. Everything from an empty bar to
    // past any human lift, in tenths: none may drift on the way through kilos.
    const drifted: number[] = [];
    for (let tenths = 0; tenths <= 15_000; tenths++) {
      const typed = tenths / 10;
      if (loadIn(loadFromInput(typed, "lb"), "lb") !== typed) drifted.push(typed);
    }
    expect(drifted).toEqual([]);
  });

  it("stores pounds to the gram, so an export never reads 102.05828325", () => {
    const kg = loadFromInput(225, "lb");
    expect(Math.round(kg * 1000) / 1000).toBe(kg);
  });
});

describe("loadNumber / loadLabel", () => {
  it("trims trailing zeroes and names the unit", () => {
    expect(loadNumber(145, "kg")).toBe("145");
    expect(loadLabel(142.5, "kg")).toBe("142.5 kg");
    expect(loadLabel(102.058, "lb")).toBe("225 lb");
    expect(loadLabel(100, "lb")).toBe("220.5 lb");
  });

  it("names the unit for a screen reader", () => {
    expect(unitName("kg")).toBe("kilograms");
    expect(unitName("lb")).toBe("pounds");
  });
});
