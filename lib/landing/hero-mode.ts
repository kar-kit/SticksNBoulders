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

/** The logo. The first frame, the last frame and the poster. */
export const FINAL_POSE: Pose = {
  form: 0,
  plates: 1,
  barY: PLATE_RADIUS,
  barZ: 0,
  bend: 0,
  rack: 0,
  hook: 1.75,
  bench: 0,
  deck: 0,
  yaw: -0.32,
  pitch: 0.12,
  camY: 0.86,
  camDist: 7.2,
};
export const FINAL_LABEL = "Sticks and boulders";

/**
 * Something landing: a plate slammed against the one before it, or the bar
 * set down on the platform. It happens at the end of its step, then shakes
 * the camera, flexes the bar and throws chips for a second or so.
 */
export interface Impact {
  /** A plate slammed on, the bar set on the platform, or the bar racked on the hooks (a clank: shake, no chips). */
  kind: "plate" | "floor" | "hook";
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
