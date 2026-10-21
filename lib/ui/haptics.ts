/**
 * Haptic feedback for the athlete's phone, where the platform has any.
 *
 * Android Chrome has `navigator.vibrate`. iOS Safari does not, in a tab or an
 * installed PWA, so on an iPhone every call here is a silent no-op and the
 * visual feedback has to carry the moment on its own. Nothing may depend on a
 * buzz arriving. docs/athlete-motion.md has the iOS note.
 *
 * Not gated on reduced motion. A vibration moves nothing on screen, and
 * reduced motion is about what moves on screen; iOS keeps its own system
 * haptics under Reduce Motion for the same reason.
 *
 * Patterns are milliseconds on, off, on... Chrome needs a user activation on
 * the page before it will vibrate (any earlier tap counts), and refuses or
 * throws otherwise; that is a no-op here too.
 */

export type HapticKind = "light" | "medium" | "success" | "warning" | "alert";

export const HAPTICS: Readonly<Record<HapticKind, readonly number[]>> = {
  /** A tap answering: a stepper tick, a toggle. Barely there. */
  light: [8],
  /** A firmer answer: a sheet snapping open, a row arming for delete. */
  medium: [16],
  /** Something saved: a set logged. Two quick taps. */
  success: [12, 60, 18],
  /** Something needs a look: a refusal, a destructive confirm. */
  warning: [30, 80, 30],
  /** Felt through a pocket, not loud enough to be a phone call: a rest ending. */
  alert: [200, 100, 200],
};

type Vibrator = { vibrate?: (pattern: number[]) => boolean };

/**
 * Plays `kind`. True if the platform accepted it, false wherever it could
 * not: no navigator (server, tests), no vibrate (iOS), refused or thrown
 * (no user activation yet). Never throws.
 */
export function haptic(
  kind: HapticKind,
  nav: Vibrator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  try {
    if (!nav || typeof nav.vibrate !== "function") return false;
    return nav.vibrate([...HAPTICS[kind]]) === true;
  } catch {
    return false;
  }
}
