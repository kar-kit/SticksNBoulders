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

/**
 * Never below zero. At zero the rest is over and the screen takes the bar
 * down, so there is no overtime to count.
 */
export function restRemainingMs(timer: RestTimer, now: Date = new Date()): number {
  return Math.max(0, timer.startedAt.getTime() + timer.restMs - now.getTime());
}

export const isRestOver = (timer: RestTimer, now: Date = new Date()): boolean =>
  restRemainingMs(timer, now) <= 0;

/**
 * How late the end of a rest can be noticed and still be worth a buzz.
 *
 * The screen ticks once a second, so an on-time end is seen within a second.
 * A rest that ended while the tab was hidden or the phone was locked is
 * noticed whenever the athlete comes back, which can be minutes later; a
 * vibration then announces nothing and just startles. Past this window the bar
 * goes quietly.
 */
export const BUZZ_WINDOW_MS = 3_000;

/** Whether this rest has just ended, as opposed to having ended a while ago. */
export function restJustEnded(timer: RestTimer, now: Date = new Date()): boolean {
  const overBy = now.getTime() - (timer.startedAt.getTime() + timer.restMs);
  return overBy >= 0 && overBy <= BUZZ_WINDOW_MS;
}

/**
 * `2:00`, counting down to `0:00`. A negative input reads as `0:00`: the rest
 * is over, and the bar is about to go.
 */
export function formatRest(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Short double pulse. Felt through a pocket, not loud enough to be a phone call. */
export const REST_BUZZ: readonly number[] = [200, 100, 200];

/**
 * Buzzes the phone at the end of a rest, where the platform allows it.
 *
 * Guarded every way it can fail: iOS Safari has no `navigator.vibrate`, some
 * browsers throw without a recent user gesture, and a test runner has no
 * navigator worth the name. Losing the buzz costs nothing -- the bar going is
 * the signal -- so nothing here is allowed to throw.
 */
export function buzzRestOver(nav: { vibrate?: (pattern: number[]) => boolean } | undefined =
  typeof navigator === "undefined" ? undefined : navigator): boolean {
  try {
    if (!nav || typeof nav.vibrate !== "function") return false;
    return nav.vibrate([...REST_BUZZ]);
  } catch {
    return false;
  }
}
