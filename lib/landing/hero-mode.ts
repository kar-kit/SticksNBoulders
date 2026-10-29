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
/** Gathering speed all the way in: a plate slammed home, a bar set down. */
const slam = (x: number): number => x * x * x;
/** A heavy pull: slow off the floor, faster through the middle, eased into lockout. */
const grind = (x: number): number => easeInOut(x) * 0.85 + x * x * 0.15;
const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** A bar's whip: a bump early in the concentric, gone by `until`. */
const whip = (k: number, size: number, until = 0.45): number => (k < until ? Math.sin((Math.PI * k) / until) * size : 0);

/**
 * Something landing: a plate slammed against the one before it, or the bar
 * set down on the platform. It happens at the end of its step, then shakes
 * the camera, flexes the bar and throws chips for a second or so.
 */
export interface Impact {
  kind: "plate" | "floor";
  /** For a plate, which slot it lands in (0 at the collar). */
  slot: number;
  /** 1 is a normal hit. The fourth plate and the set-down hit harder. */
  strength: number;
}

/** An impact that is still playing out, `age` seconds after it landed. */
export interface Burst extends Impact {
  age: number;
  /** Seeds the chips, so a burst looks the same every time it plays. */
  seed: number;
}

/** What is still moving from impacts: a camera shake and the chips in the air. */
export interface Fx {
  /** Camera shake as a fraction of the box's shorter side. */
  shakeX: number;
  shakeY: number;
  bursts: Burst[];
}

export const NO_FX: Fx = { shakeX: 0, shakeY: 0, bursts: [] };
/** How long a burst's chips and shake last. */
export const BURST_SECONDS = 1.1;

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

/** A plate slammed on each end. Harder each time; the fourth hits hardest. */
const load = (n: number, ms: number, strength: number, yaw: number): Step[] => [
  {
    ms,
    to: { plates: n, yaw },
    ease: slam,
    label: `Deadlift \u00b7 ${plates(n)}`,
    impact: { kind: "plate", slot: n - 1, strength },
  },
  { ms: 380 + strength * 220, to: {} },
];

/*
 * The story, about 14 seconds. The logo; the stick becomes a bar and the
 * boulder its first plates, which land on a platform; three more plates
 * slammed on, one at a time, each harder than the last; then one heavy
 * deadlift, slow off the floor, set down hard. Then it folds back into the
 * logo. Same picture first and last, so the poster, the canvas's first frame
 * and its last are one.
 */
const STEPS: Step[] = [
  { ms: 1000, to: {}, label: FINAL_LABEL },
  {
    ms: 2300,
    to: { form: 1, deck: 1, barY: FLOOR, yaw: -0.74, pitch: 0.36, camY: 0.95, camDist: 7.6 },
    label: `Deadlift \u00b7 ${plates(1)}`,
    impact: { kind: "floor", slot: 0, strength: 0.55 },
  },
  { ms: 450, to: {} },
  ...load(2, 520, 0.7, -0.68),
  ...load(3, 480, 0.85, -0.62),
  ...load(4, 440, 1.15, -0.56),

  // The one lift. A beat set up, then the pull: slow off the floor, the bar
  // bending under four plates, the camera leaning in. Lockout, then down hard.
  { ms: 350, to: {} },
  {
    ms: 2100,
    to: { barY: LOCKOUT, bend: 0.045, camDist: 6.9, camY: 1.1 },
    ease: grind,
    whip: (k) => whip(k, 0.15, 0.5),
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
    pose.bend += (hit.kind === "floor" ? 0.07 : 0.04) * Math.exp(-age * 6) * hit.strength * Math.sin(age * 38);
    fx.bursts.push({ kind: hit.kind, slot: hit.slot, strength: hit.strength, age, seed: hit.seed });
  }
  return { pose, label, fx };
}

/** Every label the story shows, in order. For tests and the doc. */
export const LABELS = TRACK.map((t) => t.label).filter((l, i, all) => l !== all[i - 1]);
