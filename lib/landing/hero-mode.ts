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

/*
 * The playback timeline, in milliseconds. The page opens on the finished
 * boulder (the poster), holds it, runs the years backwards to one stick,
 * then builds them forward again. You see the end first, because that is all
 * anyone ever sees of a lifter.
 */
export const HOLD_MS = 900;
export const REWIND_MS = 1300;
export const PAUSE_MS = 300;
export const BUILD_MS = 6500;
export const TOTAL_MS = HOLD_MS + REWIND_MS + PAUSE_MS + BUILD_MS;

const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** Timeline position (0 = one stick, 1 = the logo) at `ms` into playback. */
export function timelineAt(ms: number): number {
  if (ms <= HOLD_MS) return 1;
  if (ms <= HOLD_MS + REWIND_MS) return 1 - easeInOut((ms - HOLD_MS) / REWIND_MS);
  if (ms <= HOLD_MS + REWIND_MS + PAUSE_MS) return 0;
  return Math.min(1, (ms - HOLD_MS - REWIND_MS - PAUSE_MS) / BUILD_MS);
}
