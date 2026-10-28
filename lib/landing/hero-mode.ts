/**
 * Whether the landing hero animates or stays a still picture.
 *
 * The still is the server-rendered SVG poster and it is the default: it is
 * what a visitor without JavaScript, with reduced motion, on Save-Data or on a
 * device that cannot keep up sees, and it is the same picture the animation
 * ends on. Animating is the exception that has to earn its place.
 */

/** The hero's counter runs to this. Three years of weeks; illustrative, not a claim. */
export const TOTAL_WEEKS = 156;

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

/** A moment of the hero. lib/landing/hero-geometry.ts draws it. */
export interface Pose {
  /** 0 = one twig on the platform, 1 = a loaded barbell. */
  build: number;
  /** 0 = plates on the floor, 1 = locked out. */
  lift: number;
  /** The camera's turn around the bar, in radians. */
  yaw: number;
}

/** The poster's camera angle, and where every playback starts and ends. */
export const REST_YAW = -0.7;
/** How far the camera swings round over a playback. */
const SWING = -0.35;
/** Reps in the set. The build ends on the first; the rest follow. */
export const REPS = 3;

/** The poster: built, locked out on the last rep, at rest. */
export const FINAL_POSE: Pose = { build: 1, lift: 1, yaw: REST_YAW };
export const FINAL_LABEL = `Week ${TOTAL_WEEKS} \u00b7 Rep ${REPS}`;

/*
 * The playback timeline, in milliseconds. The page opens on the loaded bar
 * at lockout (the poster), holds it, runs the years backwards to one twig,
 * then builds them forward: sticks, plates, the first pull. Two more reps
 * make it a triple, and it stops where it started. You see the end first,
 * because that is all anyone ever sees of a lifter.
 */
export const HOLD_MS = 900;
export const REWIND_MS = 1700;
export const PAUSE_MS = 300;
export const BUILD_MS = 7200;
/** One rep after the first: down, a breath on the floor, up, hold. */
export const LOWER_MS = 1100;
export const FLOOR_MS = 700;
export const PULL_MS = 1400;
export const TOP_MS = 800;
const REP_MS = LOWER_MS + FLOOR_MS + PULL_MS + TOP_MS;
const STORY_MS = HOLD_MS + REWIND_MS + PAUSE_MS + BUILD_MS;
export const TOTAL_MS = STORY_MS + (REPS - 1) * REP_MS;
/** Share of the build spent making the barbell; the rest is the first pull. */
const MAKE = 0.8;

const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
/** A heavy pull: slow off the floor, faster through the middle, eased into lockout. */
const pull = (x: number): number => easeInOut(x) * 0.85 + x * x * 0.15;
const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The story from one twig (0) to the first lockout (1). */
function story(s: number): { build: number; lift: number } {
  return { build: clamp(s / MAKE), lift: pull(clamp((s - MAKE) / (1 - MAKE))) };
}

export interface Moment {
  pose: Pose;
  /** The line under the hero. */
  label: string;
}

/** Where playback is, `ms` in. Past the end it holds the poster. */
export function momentAt(ms: number): Moment {
  const at = Math.max(0, Math.min(ms, TOTAL_MS));
  // Out and back: the swing starts and ends at the poster's angle.
  const yaw = REST_YAW + SWING * Math.sin((Math.PI * at) / TOTAL_MS);
  const weeks = (build: number) => `Week ${1 + Math.round(build * (TOTAL_WEEKS - 1))}`;

  // Exactly the poster at both ends, not sin(π)'s 1e-16 away from it.
  if (at <= 0 || at >= TOTAL_MS) return { pose: FINAL_POSE, label: FINAL_LABEL };
  if (at <= HOLD_MS) return { pose: { ...FINAL_POSE, yaw }, label: FINAL_LABEL };
  if (at <= HOLD_MS + REWIND_MS) {
    const { build, lift } = story(1 - easeInOut((at - HOLD_MS) / REWIND_MS));
    return { pose: { build, lift, yaw }, label: weeks(build) };
  }
  if (at <= STORY_MS) {
    const s = clamp((at - HOLD_MS - REWIND_MS - PAUSE_MS) / BUILD_MS);
    const { build, lift } = story(s);
    return { pose: { build, lift, yaw }, label: s > MAKE ? `Week ${TOTAL_WEEKS} \u00b7 Rep 1` : weeks(build) };
  }
  const into = at - STORY_MS;
  const rep = Math.min(REPS, 2 + Math.floor(into / REP_MS));
  const r = into - (rep - 2) * REP_MS;
  let lift = 1;
  if (r < LOWER_MS) lift = 1 - easeInOut(r / LOWER_MS);
  else if (r < LOWER_MS + FLOOR_MS) lift = 0;
  else if (r < LOWER_MS + FLOOR_MS + PULL_MS) lift = pull((r - LOWER_MS - FLOOR_MS) / PULL_MS);
  // The count changes as the bar leaves the floor, not as it comes down.
  const shown = r < LOWER_MS + FLOOR_MS ? rep - 1 : rep;
  return { pose: { build: 1, lift, yaw }, label: `Week ${TOTAL_WEEKS} \u00b7 Rep ${shown}` };
}
