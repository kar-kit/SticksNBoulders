/**
 * The number pad's input rules.
 *
 * No keyboard ever appears on the logging screen, so this is how every number
 * in the product gets typed. It is a state machine rather than an <input>
 * because the behaviour athletes expect from a calculator -- the existing value
 * is selected, so the first digit replaces it rather than appending -- is not
 * what a text field does by default, and "142.5" silently becoming "142.57" is
 * a wrong number in someone's training log.
 */

export type PadField = "load" | "reps";
export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

export interface PadState {
  field: PadField;
  /** What is on screen, as typed. Kept as text so "142." is a valid moment. */
  text: string;
  /** The next digit replaces everything, the way a selected value behaves. */
  replacing: boolean;
}

/** Load takes one decimal place beyond the smallest plate; reps are whole. */
const LIMITS: Record<PadField, { integerDigits: number; decimals: number }> = {
  // 9999.99 kg is past any human lift and past any plate maths.
  load: { integerDigits: 4, decimals: 2 },
  reps: { integerDigits: 3, decimals: 0 },
};

export function beginEdit(field: PadField, value: number | null): PadState {
  return {
    field,
    text: value === null || !Number.isFinite(value) ? "" : stripTrailingZeroes(String(value)),
    // True even when empty, so the first keypress behaves the same either way.
    replacing: true,
  };
}

function stripTrailingZeroes(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function press(state: PadState, key: PadKey): PadState {
  const limits = LIMITS[state.field];

  if (key === "back") {
    // Backspace always edits what is there rather than clearing it: an athlete
    // correcting the last digit of 142.5 means 142., not empty.
    return { ...state, text: state.text.slice(0, -1), replacing: false };
  }

  const base = state.replacing ? "" : state.text;

  if (key === ".") {
    if (limits.decimals === 0) return { ...state, replacing: false };
    if (base.includes(".")) return { ...state, text: base, replacing: false };
    // A leading dot means "0.", which is what someone typing .5 intends.
    return { ...state, text: base === "" ? "0." : `${base}.`, replacing: false };
  }

  const [whole = "", fraction] = base.split(".");
  const hasPoint = base.includes(".");

  if (hasPoint) {
    if ((fraction ?? "").length >= limits.decimals) return { ...state, text: base, replacing: false };
  } else {
    if (whole.length >= limits.integerDigits) return { ...state, text: base, replacing: false };
    // A leading zero is never meaningful in a load or a rep count.
    if (whole === "0") return { ...state, text: key, replacing: false };
  }

  return { ...state, text: base + key, replacing: false };
}

/** Null when nothing usable has been typed. "142." reads as 142. */
export function padValue(state: PadState): number | null {
  if (state.text === "" || state.text === ".") return null;
  const parsed = Number(state.text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** What the pad shows. Never empty, so the cell does not collapse mid-edit. */
export function padDisplay(state: PadState): string {
  return state.text === "" ? "0" : state.text;
}

/**
 * Clears an RPE that a row should no longer carry.
 *
 * Marking a set as a warm-up after typing an RPE has to drop it. Warm-ups never
 * ask for RPE and are excluded from PRs and rollups anyway, so a warm-up
 * carrying one is a value nothing will ever read and everything would have to
 * explain.
 */
export function rpeAfterWarmupChange<T>(isWarmup: boolean, rpe: T | null): T | null {
  return isWarmup ? null : rpe;
}
