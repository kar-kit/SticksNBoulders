import { computeDots, epley1RM } from "../dots.js";

describe("computeDots (leaderboard function)", () => {
  it("matches the same known male reference value as the app's lib/dots.ts", () => {
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

  it("returns 0 for a 0kg lift", () => {
    expect(computeDots(0, 80, "male")).toBe(0);
  });

  it("differs between male and female coefficients", () => {
    expect(computeDots(150, 70, "male")).not.toBeCloseTo(computeDots(150, 70, "female"), 5);
  });
});

describe("epley1RM (leaderboard function)", () => {
  it("returns the raw weight for a single rep", () => {
    expect(epley1RM(150, 1)).toBe(150);
  });

  it("applies the Epley formula above 1 rep", () => {
    expect(epley1RM(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 10);
  });
});
