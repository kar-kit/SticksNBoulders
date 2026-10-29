/**
 * The hero's timeline: what happens when, as a pure function of time.
 *
 * Kept apart from hero-mode.ts on purpose. hero.tsx imports hero-mode for the
 * fallback decision, so anything in that file ships in the page's first
 * JavaScript. This file is only reached from the lazily loaded canvas loop.
 */

import {
  BURST_SECONDS,
  FINAL_LABEL,
  FINAL_POSE,
  NO_FX,
  PLATE_RADIUS,
  type Fx,
  type Impact,
  type Pose,
} from "./hero-mode";

const FLOOR = PLATE_RADIUS;
const LOCKOUT = FLOOR + 0.8;
const SQUAT_HOOK = 1.75;
const BENCH_HOOK = 1.3;

const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
/** Gathering speed all the way in: a plate slammed home, a bar set down. */
const slam = (x: number): number => x * x * x;
/** A heavy pull: slow off the floor, faster through the middle, eased into lockout. */
const grind = (x: number): number => easeInOut(x) * 0.85 + x * x * 0.15;
const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** A bar's whip: a bump early in the concentric, gone by `until`. */
const whip = (k: number, size: number, until = 0.45): number => (k < until ? Math.sin((Math.PI * k) / until) * size : 0);

interface Step {
  ms: number;
  /** The pose at the end of the step: whatever changes, on top of the step before. */
  to: Partial<Pose>;
  ease?: (x: number) => number;
  /** The line under the hero, from this step on. */
  label?: string;
  /** Extra bend while the step runs, on top of the blend. */
  whip?: (k: number) => number;
  /** Lands as the step ends. */
  impact?: Impact;
}

const plates = (n: number) => `${n} plate${n === 1 ? "" : "s"}`;
type Lift = "Squat" | "Bench" | "Deadlift";

/** A plate slammed on each end. Harder each time, hardest on a full bar. */
const load = (lift: Lift, n: number, strength: number, yaw: number): Step[] => [
  {
    ms: 560 - n * 30,
    to: { plates: n, yaw },
    ease: slam,
    label: `${lift} \u00b7 ${plates(n)}`,
    impact: { kind: "plate", slot: n - 1, strength },
  },
  { ms: 380 + strength * 220, to: {} },
];

/** Back down to one plate a side for the next lift. Quick, and nothing lands. */
const strip = (lift: Lift): Step => ({ ms: 650, to: { plates: 1 }, label: `${lift} \u00b7 ${plates(1)}` });

/*
 * The story, in competition order: squat, bench, deadlift. The logo; the
 * stick becomes a bar and the boulder its first plates, which land on a
 * platform. A rack rises, the bar goes onto the hooks, two more plates are
 * slammed on, one squat. Stripped back, the hooks drop, a bench rises, a
 * plate slammed on, one paused bench press. Stripped again, the rack and bench
 * sink, the bar lands on the platform, three plates slammed on, one deadlift,
 * set down hard. Then it folds back into the logo. Same picture first and
 * last, so the poster, the canvas's first frame and its last are one.
 *
 * A bar under load bends a little, not a lot: the whips here are a few
 * hundredths of a unit on a bar 4.4 long.
 */
const STEPS: Step[] = [
  { ms: 1000, to: {}, label: FINAL_LABEL },
  {
    ms: 2300,
    to: { form: 1, deck: 1, barY: FLOOR, yaw: -0.6, pitch: 0.34, camY: 1.05, camDist: 7.9 },
    label: `Squat \u00b7 ${plates(1)}`,
    impact: { kind: "floor", slot: 0, strength: 0.55 },
  },

  // Squat. The rack grows; the bar goes up in front of the hooks and back onto them.
  { ms: 950, to: { rack: 1, hook: SQUAT_HOOK, yaw: -0.48, pitch: 0.3, camY: 1.25, camDist: 8.2 } },
  { ms: 850, to: { barY: SQUAT_HOOK + 0.1, barZ: 0.36 } },
  { ms: 420, to: { barY: SQUAT_HOOK, barZ: 0 }, ease: slam, impact: { kind: "hook", slot: 0, strength: 0.5 } },
  { ms: 300, to: {} },
  ...load("Squat", 2, 0.7, -0.45),
  ...load("Squat", 3, 0.95, -0.42),
  { ms: 600, to: { barY: SQUAT_HOOK + 0.07, barZ: 0.36, bend: 0.012 } },
  { ms: 1150, to: { barY: 1.05 } },
  { ms: 1150, to: { barY: SQUAT_HOOK + 0.07 }, ease: grind, whip: (k) => whip(k, 0.02, 0.4) },
  { ms: 600, to: { barY: SQUAT_HOOK, barZ: 0, bend: 0 }, impact: { kind: "hook", slot: 0, strength: 0.7 } },
  { ms: 300, to: {} },

  // Bench. Stripped, the hooks drop carrying the bar, the bench rises, a
  // plate slammed on. Unrack, down, a competition pause, press, rack.
  strip("Bench"),
  { ms: 1300, to: { hook: BENCH_HOOK, barY: BENCH_HOOK, bench: 1, yaw: -0.55, pitch: 0.52, camY: 0.95, camDist: 7.8 } },
  ...load("Bench", 2, 0.85, -0.52),
  { ms: 600, to: { barY: BENCH_HOOK + 0.06, barZ: 0.3, bend: 0.008 } },
  { ms: 1000, to: { barY: 0.84 } },
  { ms: 480, to: {} },
  { ms: 1000, to: { barY: BENCH_HOOK + 0.06 }, ease: grind, whip: (k) => whip(k, 0.015, 0.4) },
  { ms: 600, to: { barY: BENCH_HOOK, barZ: 0, bend: 0 }, impact: { kind: "hook", slot: 0, strength: 0.6 } },
  { ms: 300, to: {} },

  // Deadlift. Stripped, off the hooks, the rack and bench sink and the bar
  // lands on the platform. Three plates slammed on, one pull, set down hard.
  strip("Deadlift"),
  { ms: 500, to: { barY: BENCH_HOOK + 0.06, barZ: 0.3 } },
  {
    ms: 1300,
    to: { rack: 0, bench: 0, barY: FLOOR, barZ: 0, yaw: -0.74, pitch: 0.36, camY: 0.95, camDist: 7.6 },
    impact: { kind: "floor", slot: 0, strength: 0.7 },
  },
  { ms: 300, to: {} },
  ...load("Deadlift", 2, 0.7, -0.68),
  ...load("Deadlift", 3, 0.85, -0.62),
  ...load("Deadlift", 4, 1.15, -0.56),
  { ms: 350, to: {} },
  {
    ms: 2100,
    to: { barY: LOCKOUT, bend: 0.018, camDist: 6.9, camY: 1.1 },
    ease: grind,
    whip: (k) => whip(k, 0.05, 0.5),
  },
  { ms: 750, to: {} },
  {
    ms: 430,
    to: { barY: FLOOR, bend: 0, camDist: 7.6, camY: 0.95 },
    ease: slam,
    impact: { kind: "floor", slot: 0, strength: 1.4 },
  },
  { ms: 1100, to: {} },

  // Home: the plates come off back to one a side, then it all folds back
  // into the stick and the boulder.
  { ms: 800, to: { plates: 1, yaw: -0.66 }, label: FINAL_LABEL },
  { ms: 2100, to: FINAL_POSE },
  { ms: 700, to: {} },
];

/** Each step's start pose, label and start time, worked out once. */
const TRACK = (() => {
  let pose = FINAL_POSE;
  let label = FINAL_LABEL;
  let start = 0;
  return STEPS.map((step) => {
    const from = pose;
    const to = { ...pose, ...step.to };
    label = step.label ?? label;
    const entry = { step, from, to, label, start };
    pose = to;
    start += step.ms;
    return entry;
  });
})();

export const TOTAL_MS = TRACK[TRACK.length - 1].start + STEPS[STEPS.length - 1].ms;

/** Every impact and the moment it lands, in ms. */
export const IMPACTS = TRACK.filter((t) => t.step.impact).map((t, i) => ({
  ...t.step.impact!,
  at: t.start + t.step.ms,
  seed: 0x1a2b + i * 977,
}));

export interface Moment {
  pose: Pose;
  /** The line under the hero. */
  label: string;
  fx: Fx;
}

const blend = (a: Pose, b: Pose, k: number): Pose => {
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof Pose)[]) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
};

/** Where playback is, `ms` in. Before the start and past the end it is the poster. */
export function momentAt(ms: number): Moment {
  if (ms <= 0 || ms >= TOTAL_MS) return { pose: FINAL_POSE, label: FINAL_LABEL, fx: NO_FX };
  let i = TRACK.length - 1;
  while (i > 0 && TRACK[i].start > ms) i--;
  const { step, from, to, label, start } = TRACK[i];
  const k = clamp((ms - start) / step.ms);
  const pose = blend(from, to, (step.ease ?? easeInOut)(k));
  if (step.whip) pose.bend += step.whip(k);

  // Impacts still ringing: a decaying shake, the bar flexing, chips flying.
  const fx: Fx = { shakeX: 0, shakeY: 0, bursts: [] };
  for (const hit of IMPACTS) {
    const age = (ms - hit.at) / 1000;
    if (age < 0 || age > BURST_SECONDS) continue;
    const decay = Math.exp(-age * 9) * hit.strength;
    fx.shakeX += 0.022 * decay * Math.sin(age * 72 + hit.seed);
    fx.shakeY += 0.018 * decay * Math.cos(age * 57 + hit.seed);
    // A small flex: a loaded bar rings, it does not flap.
    pose.bend += (hit.kind === "floor" ? 0.025 : 0.012) * Math.exp(-age * 7) * hit.strength * Math.sin(age * 40);
    // A rack clank shakes but throws nothing.
    if (hit.kind !== "hook") fx.bursts.push({ kind: hit.kind, slot: hit.slot, strength: hit.strength, age, seed: hit.seed });
  }
  return { pose, label, fx };
}

/** Every label the story shows, in order. For tests and the doc. */
export const LABELS = TRACK.map((t) => t.label).filter((l, i, all) => l !== all[i - 1]);
