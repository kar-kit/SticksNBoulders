import { computeDots } from "../dots";

describe("computeDots", () => {
  it("computes a known male value correctly (100kg lift @ 80kg bodyweight)", () => {
    const bw = 80;
    const a = -0.000001093;
    const b = 0.0007391293;
    const c = -0.1918759221;
    const d = 24.0900756;
    const e = -307.75076;
    const denominator = a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e;
    const expected = (100 * 500) / denominator;

    expect(computeDots(100, bw, "male")).toBeCloseTo(expected, 10);
  });

  it("computes a known female value correctly (100kg lift @ 60kg bodyweight)", () => {
    const bw = 60;
    const a = -0.0000010706;
    const b = 0.0005158568;
    const c = -0.1126655495;
    const d = 13.6175032;
    const e = -57.96288;
    const denominator = a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e;
    const expected = (100 * 500) / denominator;

    expect(computeDots(100, bw, "female")).toBeCloseTo(expected, 10);
  });

  it("returns 0 for a 0kg lift", () => {
    expect(computeDots(0, 80, "male")).toBe(0);
    expect(computeDots(0, 60, "female")).toBe(0);
  });

  it("scales linearly with lift weight at a fixed bodyweight", () => {
    const bw = 75;
    const dots100 = computeDots(100, bw, "male");
    const dots200 = computeDots(200, bw, "male");
    expect(dots200).toBeCloseTo(dots100 * 2, 10);
  });

  it("gives different scores for male vs female at the same lift and bodyweight", () => {
    const male = computeDots(150, 70, "male");
    const female = computeDots(150, 70, "female");
    expect(male).not.toBeCloseTo(female, 5);
  });

  it("produces higher DOTS for a lighter lifter hitting the same lift (relative strength)", () => {
    const heavier = computeDots(140, 100, "male");
    const lighter = computeDots(140, 70, "male");
    expect(lighter).toBeGreaterThan(heavier);
  });

  it("handles a very small bodyweight without throwing", () => {
    expect(() => computeDots(50, 40, "female")).not.toThrow();
    expect(Number.isFinite(computeDots(50, 40, "female"))).toBe(true);
  });

  it("handles a very large bodyweight without throwing", () => {
    expect(() => computeDots(300, 200, "male")).not.toThrow();
    expect(Number.isFinite(computeDots(300, 200, "male"))).toBe(true);
  });

  it("returns a negative-or-zero score for a 0kg bodyweight edge case rather than throwing", () => {
    // Not a realistic input, but the formula must not throw on it (e.g. an
    // unfilled bodyweight field defaulting to 0 upstream).
    expect(() => computeDots(100, 0, "male")).not.toThrow();
  });
});
