/**
 * The rest timer.
 *
 * Table stakes against Strong, and deliberately less than Strong offers: no
 * per-exercise defaults, no configuration screen, no saved presets. Strong cut
 * that on purpose and the feature list says so. Two minutes, a +30s button, and
 * a way to dismiss it.
 *
 * Everything here is a pure function of (startedAt, restMs, now) for the same
 * reason the session clock is: a phone that slept through the rest, or was
 * reloaded, or took a call, must come back showing the truth rather than
 * whatever a tick counter managed to count. There is no interval in this file
 * and there should never be one.
 */

export interface RestTimer {
  /** When the set that started this rest was logged. */
  startedAt: Date;
  /** How long the rest is, after any +30s taps. Not a countdown. */
  restMs: number;
}

/** Two minutes. The blueprint's figure, and not adjustable by design. */
export const DEFAULT_REST_MS = 120_000;

/** What +30s adds. */
export const EXTEND_MS = 30_000;

export const startRest = (startedAt: Date = new Date()): RestTimer => ({
  startedAt,
  restMs: DEFAULT_REST_MS,
});

/** Additive across taps: three presses is ninety seconds, not thirty. */
export const extendRest = (timer: RestTimer): RestTimer => ({
  ...timer,
  restMs: timer.restMs + EXTEND_MS,
});

/** Negative once the rest is over. Nothing clamps it -- see formatRest. */
export function restRemainingMs(timer: RestTimer, now: Date = new Date()): number {
  return timer.startedAt.getTime() + timer.restMs - now.getTime();
}

export const isRestOver = (timer: RestTimer, now: Date = new Date()): boolean =>
  restRemainingMs(timer, now) <= 0;

/**
 * `2:00`, and `-0:12` once the rest is over.
 *
 * Counting up past zero rather than stopping or vanishing, because the useful
 * question between sets is not "is the rest finished" -- it finished, that is
 * why the number turned -- but "how far over am I". Same behaviour Strong has,
 * and the one an athlete already reads without thinking.
 */
export function formatRest(ms: number): string {
  const over = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${over ? "-" : ""}${minutes}:${String(seconds).padStart(2, "0")}`;
}
