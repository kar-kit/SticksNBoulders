export type Sex = "male" | "female";

// DOTS coefficients, applied per-lift rather than to the traditional 3-lift total.
const DOTS_COEFFICIENTS: Record<Sex, { a: number; b: number; c: number; d: number; e: number }> = {
  male: {
    a: -0.000001093,
    b: 0.0007391293,
    c: -0.1918759221,
    d: 24.0900756,
    e: -307.75076,
  },
  female: {
    a: -0.0000010706,
    b: 0.0005158568,
    c: -0.1126655495,
    d: 13.6175032,
    e: -57.96288,
  },
};

/** DOTS score for a single lift, given the lift load and the lifter's bodyweight, both in kg. */
export function computeDots(liftKg: number, bodyweightKg: number, sex: Sex): number {
  const { a, b, c, d, e } = DOTS_COEFFICIENTS[sex];
  const bw = bodyweightKg;
  const denominator = a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e;
  return (liftKg * 500) / denominator;
}
