// Mirrors lib/dots.ts and lib/lift-stats.ts in the Next app -- duplicated here because
// this function deploys standalone and can't import from the app's source tree.
const DOTS_COEFFICIENTS = {
  male: { a: -0.000001093, b: 0.0007391293, c: -0.1918759221, d: 24.0900756, e: -307.75076 },
  female: { a: -0.0000010706, b: 0.0005158568, c: -0.1126655495, d: 13.6175032, e: -57.96288 },
};

export function computeDots(liftKg, bodyweightKg, sex) {
  const { a, b, c, d, e } = DOTS_COEFFICIENTS[sex];
  const bw = bodyweightKg;
  const denominator = a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e;
  return (liftKg * 500) / denominator;
}

export function epley1RM(weightKg, reps) {
  return reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
}
