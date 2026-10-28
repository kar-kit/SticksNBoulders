/**
 * Whether the landing hero animates or stays a still picture.
 *
 * The still is the server-rendered SVG poster and it is the default: it is
 * what a visitor without JavaScript, with reduced motion, on Save-Data or on a
 * device that cannot keep up sees, and it is the same picture the animation
 * ends on. Animating is the exception that has to earn its place.
 */

export type HeroMode = "animate" | "still";

export interface HeroEnvironment {
  reducedMotion: boolean;
  /** `navigator.connection.saveData`. Chrome and Android only; absent reads as false. */
  saveData: boolean;
  /** Whether a 2D canvas context could be had at all. */
  canvas: boolean;
  /** `navigator.hardwareConcurrency`, when the browser says. */
  cores: number | undefined;
}

/** Two cores or fewer is a phone that will be busy enough parsing the page. */
const MIN_CORES = 3;

export function chooseHero(env: HeroEnvironment): HeroMode {
  if (env.reducedMotion || env.saveData || !env.canvas) return "still";
  if (env.cores !== undefined && env.cores < MIN_CORES) return "still";
  return "animate";
}

/** Frames measured before deciding. About a third of a second at 60 Hz. */
export const SAMPLE_FRAMES = 20;
/** Median frame gap that counts as not keeping up: under ~30 fps. */
export const SLOW_FRAME_MS = 34;

/**
 * True once enough frames say the device is struggling. A median, not a mean,
 * so one long frame (a font arriving, a tab switch) does not end the show.
 */
export function tooSlow(frameGapsMs: readonly number[]): boolean {
  if (frameGapsMs.length < SAMPLE_FRAMES) return false;
  const sorted = [...frameGapsMs.slice(0, SAMPLE_FRAMES)].sort((a, b) => a - b);
  const median = (sorted[SAMPLE_FRAMES / 2 - 1] + sorted[SAMPLE_FRAMES / 2]) / 2;
  return median > SLOW_FRAME_MS;
}

/**
 * A moment of the hero: everything lib/landing/hero-geometry.ts needs to draw
 * one frame. Plain numbers, so any two poses can be blended.
 */
export interface Pose {
  /** 0 = the logo's stick leaning on its boulder, 1 = a level barbell with plates. */
  form: number;
  /** Plates per side. A fraction is a plate part way on or off the sleeve. */
  plates: number;
  /** The bar's height and depth (towards the camera). */
  barY: number;
  barZ: number;
  /** How far the ends droop below the middle. */
  bend: number;
  /** Rack uprights: 0 sunk into the platform, 1 standing. */
  rack: number;
  /** J-hook height. Squat height, then bench height. */
  hook: number;
  /** The bench: 0 sunk, 1 standing. */
  bench: number;
  /** The platform: 0 absent (the logo stands on nothing), 1 there. */
  deck: number;
  /** Camera: turn, tilt down, what it looks at, and how far away. */
  yaw: number;
  pitch: number;
  camY: number;
  camDist: number;
}

/** A plate's radius: also the bar's height when it rests on the platform. */
export const PLATE_RADIUS = 0.72;
const FLOOR = PLATE_RADIUS;
const LOCKOUT = FLOOR + 0.8;
const SQUAT_HOOK = 1.75;
const BENCH_HOOK = 1.3;

/** The logo. The first frame, the last frame and the poster. */
export const FINAL_POSE: Pose = {
  form: 0,
  plates: 1,
  barY: FLOOR,
  barZ: 0,
  bend: 0,
  rack: 0,
  hook: SQUAT_HOOK,
  bench: 0,
  deck: 0,
  yaw: -0.32,
  pitch: 0.12,
  camY: 0.86,
  camDist: 7.2,
};
export const FINAL_LABEL = "Sticks and boulders";

const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
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
}

const plates = (n: number) => `${n} plate${n === 1 ? "" : "s"}`;

/** One deadlift: the pull, a beat at lockout, down, a beat on the floor. Heavier is slower and bends more. */
const deadlift = (n: number, pullMs: number): Step[] => [
  { ms: pullMs, to: { barY: LOCKOUT, bend: 0.01 * n }, ease: grind, whip: (k) => whip(k, 0.03 + 0.025 * n) },
  { ms: 380, to: {} },
  { ms: 820, to: { barY: FLOOR, bend: 0 } },
  { ms: 260, to: {} },
];

/** On to the next plate: one slides on each end, and the camera eases round a little. */
const loadTo = (n: number, yaw: number): Step => ({
  ms: 700,
  to: { plates: n, yaw },
  label: `Deadlift \u00b7 ${plates(n)}`,
});

/*
 * The story. The logo; the stick becomes a bar and the boulder its first
 * plates; a deadlift at one plate, then two, three, four; a rack grows out
 * of the platform for a squat; the hooks come down and a bench comes up for
 * a paused bench press; everything sinks away and the bar and plates fold
 * back into the logo. Same picture first and last, so the poster, the
 * canvas's first frame and its last are one.
 */
const STEPS: Step[] = [
  { ms: 1000, to: {}, label: FINAL_LABEL },
  {
    ms: 2600,
    to: { form: 1, deck: 1, barY: FLOOR, yaw: -0.74, pitch: 0.36, camY: 0.95, camDist: 7.6 },
    label: `Deadlift \u00b7 ${plates(1)}`,
  },
  ...deadlift(1, 1100),
  loadTo(2, -0.67),
  ...deadlift(2, 1200),
  loadTo(3, -0.6),
  ...deadlift(3, 1350),
  loadTo(4, -0.53),
  ...deadlift(4, 1800),

  // Squat. A plate comes off and the rack grows; the bar goes up in front of
  // the hooks, back onto them, out, down, up, and back in.
  {
    ms: 1000,
    to: { plates: 3, rack: 1, hook: SQUAT_HOOK, yaw: -0.45, pitch: 0.3, camY: 1.25, camDist: 8.2 },
    label: `Squat \u00b7 ${plates(3)}`,
  },
  { ms: 1000, to: { barY: SQUAT_HOOK + 0.1, barZ: 0.36 } },
  { ms: 500, to: { barY: SQUAT_HOOK, barZ: 0 } },
  { ms: 450, to: {} },
  { ms: 650, to: { barY: SQUAT_HOOK + 0.07, barZ: 0.36, bend: 0.03 } },
  { ms: 1150, to: { barY: 1.05 } },
  { ms: 1150, to: { barY: SQUAT_HOOK + 0.07 }, whip: (k) => whip(k, 0.05, 0.4) },
  { ms: 600, to: { barY: SQUAT_HOOK, barZ: 0, bend: 0 } },

  // Bench. Another plate off, the hooks drop to bench height carrying the
  // bar, the bench rises. Unrack, down, a competition pause, press, rack.
  {
    ms: 1600,
    to: { plates: 2, hook: BENCH_HOOK, barY: BENCH_HOOK, bench: 1, yaw: -0.55, pitch: 0.52, camY: 0.95, camDist: 7.8 },
    label: `Bench \u00b7 ${plates(2)}`,
  },
  { ms: 600, to: { barY: BENCH_HOOK + 0.06, barZ: 0.3, bend: 0.02 } },
  { ms: 1000, to: { barY: 0.84 } },
  { ms: 480, to: {} },
  { ms: 1000, to: { barY: BENCH_HOOK + 0.06 }, whip: (k) => whip(k, 0.035, 0.4) },
  { ms: 600, to: { barY: BENCH_HOOK, barZ: 0, bend: 0 } },

  // Home: the equipment sinks, the bar comes down to one plate a side, and
  // folds back into the stick and the boulder.
  {
    ms: 1300,
    to: { rack: 0, bench: 0, plates: 1, barY: FLOOR, yaw: -0.62, pitch: 0.34, camY: 0.95, camDist: 7.6 },
    label: FINAL_LABEL,
  },
  { ms: 2200, to: FINAL_POSE },
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

export interface Moment {
  pose: Pose;
  /** The line under the hero. */
  label: string;
}

const blend = (a: Pose, b: Pose, k: number): Pose => {
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof Pose)[]) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
};

/** Where playback is, `ms` in. Before the start and past the end it is the poster. */
export function momentAt(ms: number): Moment {
  if (ms <= 0 || ms >= TOTAL_MS) return { pose: FINAL_POSE, label: FINAL_LABEL };
  let i = TRACK.length - 1;
  while (i > 0 && TRACK[i].start > ms) i--;
  const { step, from, to, label, start } = TRACK[i];
  const k = clamp((ms - start) / step.ms);
  const pose = blend(from, to, (step.ease ?? easeInOut)(k));
  if (step.whip) pose.bend += step.whip(k);
  return { pose, label };
}

/** Every label the story shows, in order. For tests and the doc. */
export const LABELS = TRACK.map((t) => t.label).filter((l, i, all) => l !== all[i - 1]);
