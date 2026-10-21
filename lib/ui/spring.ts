/**
 * The athlete's spring easings, as CSS `linear()` curves.
 *
 * A damped spring from rest at 0 to 1, with SwiftUI's two parameters:
 * `response` (the undamped period, in seconds) and `damping` (the damping
 * fraction; 1 is critical, below it overshoots). Sampled across the spring's
 * own settle time, so the curve and its duration token always belong
 * together, then simplified to as few stops as stay within `tolerance` of
 * the real curve.
 *
 * Build-time only: globals.css holds the output, regenerated with
 * `npx tsx scripts/spring-easings.mts`, and spring.test.ts fails if the two
 * drift. Nothing in the app imports this.
 */

export interface Spring {
  response: number;
  damping: number;
}

/** The three in globals.css. Changing one here means regenerating there. */
export const SPRINGS = {
  spring: { response: 0.35, damping: 0.85 },
  sheet: { response: 0.42, damping: 0.92 },
  bounce: { response: 0.38, damping: 0.6 },
} as const satisfies Record<string, Spring>;

/** Position at time `t` (seconds). */
export function springAt({ response, damping }: Spring, t: number): number {
  const w = (2 * Math.PI) / response;
  if (damping >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
}

/** Seconds until the spring stays within `epsilon` of rest, to the half-millisecond. */
export function settleTime(spring: Spring, epsilon = 0.001): number {
  let settled = 0;
  for (let t = 0; t < 3; t += 0.0005) if (Math.abs(springAt(spring, t) - 1) > epsilon) settled = t;
  return settled;
}

/** The spring as a CSS `linear()` easing, and the duration it was sampled over. */
export function springEasing(spring: Spring, tolerance = 0.002): { easing: string; ms: number } {
  const settle = settleTime(spring);
  const n = 400;
  const points = Array.from({ length: n + 1 }, (_, i) => [i / n, springAt(spring, (i / n) * settle)] as const);
  const kept = simplify(points, 0, n, tolerance);
  const stops = kept.map((i, k) => {
    const [t, y] = points[i];
    if (k === kept.length - 1) return "1";
    if (k === 0) return String(round(y, 4));
    return `${round(y, 4)} ${round(t * 100, 1)}%`;
  });
  return { easing: `linear(${stops.join(", ")})`, ms: Math.round(settle * 1000) };
}

/** Ramer-Douglas-Peucker on vertical distance: the indices worth keeping. */
function simplify(points: readonly (readonly [number, number])[], a: number, b: number, tolerance: number): number[] {
  const [t0, y0] = points[a];
  const [t1, y1] = points[b];
  let worst = 0;
  let at = -1;
  for (let i = a + 1; i < b; i++) {
    const [t, y] = points[i];
    const d = Math.abs(y - (y0 + ((y1 - y0) * (t - t0)) / (t1 - t0)));
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points, a, at, tolerance), ...simplify(points, at, b, tolerance).slice(1)];
}

function round(n: number, places: number): number {
  return Number(n.toFixed(places));
}
