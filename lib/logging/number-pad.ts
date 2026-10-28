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

import { LOAD_DECIMALS, type UnitPreference } from "@/lib/units";
import { LOADABLE_INCREMENT_KG, LOADABLE_INCREMENT_LB } from "@/lib/strength/plates";
import { MAX_DURATION_SECONDS } from "./cardio";

/**
 * The fields the pad types into. "duration" and "level" are a cardio row's
 * (F23): a time in minutes, and the machine's level.
 */
export type PadField = "load" | "reps" | "duration" | "level";
export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

export interface PadState {
  field: PadField;
  /** What is on screen, as typed. Kept as text so "142." is a valid moment. */
  text: string;
  /** The next digit replaces everything, the way a selected value behaves. */
  replacing: boolean;
  /**
   * The unit a load is being typed in. Absent means kilos. The pad holds the
   * number as the athlete reads it; the screen converts to kilos on the way
   * to the set (lib/units.ts `loadFromInput`).
   */
  unit?: UnitPreference;
}

/** Load takes one decimal place beyond the smallest plate; reps are whole. */
const LIMITS: Record<PadField, { integerDigits: number; decimals: number }> = {
  // 9999.99 kg is past any human lift and past any plate maths.
  load: { integerDigits: 4, decimals: 2 },
  reps: { integerDigits: 3, decimals: 0 },
  // F23. Whole minutes, up to 999; the seconds after the separator are
  // typed by their own rules (`pressDuration`), never as a decimal.
  duration: { integerDigits: 3, decimals: 0 },
  // A machine level: stairmaster 8, treadmill 2.5. 99.9 is past any dial.
  level: { integerDigits: 2, decimals: 1 },
};

/**
 * The duration field's separator (F23). The pad's "." key types it, and the
 * key shows ":" while a duration is open, so "20", "." , "3", "0" reads
 * 20:30 as it is typed. Minutes on their own are the common case -- "20" is
 * twenty minutes, one tap more than the number -- and seconds are there for
 * the athlete who wants them, never asked for.
 */
export const DURATION_SEPARATOR = ":";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Seconds as the pad shows them: "20" for whole minutes, "20:30" otherwise. */
function durationText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? String(minutes) : `${minutes}${DURATION_SEPARATOR}${pad2(rest)}`;
}

/**
 * A key on the duration field (F23).
 *
 * Minutes take up to three digits. The separator comes once; after it, two
 * digits of seconds, the first 0-5, so 20:75 cannot be typed rather than
 * being typed and then silently becoming 21:15. A leading separator means
 * "0:", for the athlete logging 0:45 of something.
 */
function pressDuration(state: PadState, key: PadKey): PadState {
  const base = state.replacing ? "" : state.text;
  if (key === ".") {
    if (base.includes(DURATION_SEPARATOR)) return { ...state, text: base, replacing: false };
    return { ...state, text: `${base === "" ? "0" : base}${DURATION_SEPARATOR}`, replacing: false };
  }
  const [minutes = "", seconds] = base.split(DURATION_SEPARATOR);
  if (seconds !== undefined) {
    if (seconds.length >= 2) return { ...state, text: base, replacing: false };
    if (seconds.length === 0 && Number(key) > 5) return { ...state, text: base, replacing: false };
    return { ...state, text: base + key, replacing: false };
  }
  if (minutes.length >= LIMITS.duration.integerDigits) return { ...state, text: base, replacing: false };
  if (minutes === "0") return { ...state, text: key, replacing: false };
  return { ...state, text: base + key, replacing: false };
}

/**
 * What a duration's text is in seconds. Seconds are read as written, so
 * "20:3" mid-typing is 20:03, and the "0" that follows makes it 20:30.
 */
function durationValue(text: string): number | null {
  if (text === "" || text === DURATION_SEPARATOR) return null;
  const [minutes = "", seconds = ""] = text.split(DURATION_SEPARATOR);
  const total = Number(minutes || "0") * 60 + Number(seconds || "0");
  return Number.isFinite(total) ? total : null;
}

/** `value` is in the athlete's unit, already converted from the stored kilos. */
export function beginEdit(field: PadField, value: number | null, unit?: UnitPreference): PadState {
  const empty = value === null || !Number.isFinite(value);
  return {
    field,
    // A duration arrives in seconds and is shown as minutes (F23).
    text: empty ? "" : field === "duration" ? durationText(value) : stripTrailingZeroes(String(value)),
    // True even when empty, so the first keypress behaves the same either way.
    replacing: true,
    ...(field === "load" && unit ? { unit } : {}),
  };
}

/**
 * The pad's limits for a state. A load in pounds takes one decimal, not two:
 * pound totals move in halves even on micro-plates, and one decimal is what
 * the screen shows back -- so nothing typed can read back differently.
 */
function limitsOf(state: PadState): { integerDigits: number; decimals: number } {
  const limits = LIMITS[state.field];
  return state.field === "load" && state.unit ? { ...limits, decimals: LOAD_DECIMALS[state.unit] } : limits;
}

function stripTrailingZeroes(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function press(state: PadState, key: PadKey): PadState {
  if (state.field === "duration" && key !== "back") return pressDuration(state, key);
  const limits = limitsOf(state);

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

/**
 * Null when nothing usable has been typed. "142." reads as 142. A duration
 * (F23) reads as whole seconds: "20" is 1200, "20:30" is 1230.
 */
export function padValue(state: PadState): number | null {
  if (state.field === "duration") return durationValue(state.text);
  if (state.text === "" || state.text === ".") return null;
  const parsed = Number(state.text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * What one tap of the pad's − or + moves the field by, in the unit on screen.
 *
 * A load moves by the plate pair the plate maths already uses: 2.5 kg, or
 * 5 lb in a pound gym (lib/strength/plates.ts). Reps move by one.
 */
export function stepSize(state: PadState): number {
  if (state.field === "reps" || state.field === "level") return 1;
  // A minute, in seconds (F23): the unit cardio is done in.
  if (state.field === "duration") return 60;
  return state.unit === "lb" ? LOADABLE_INCREMENT_LB : LOADABLE_INCREMENT_KG;
}

/**
 * The − / + steppers.
 *
 * Plain addition from whatever is on screen, not a snap to the plate grid:
 * 141 + 2.5 is 143.5. An athlete who typed 141 did it on purpose -- collars,
 * a calibrated bar, a machine -- and a stepper that rewrote it to 142.5 would
 * be the app second-guessing them. Never below zero, never past what the pad
 * itself would accept, and rounded to the field's decimals so 0.1 + 0.2 never
 * reaches the screen.
 *
 * The result is selected, like a freshly opened field: the next digit typed
 * replaces it rather than appending to it.
 */
export function step(state: PadState, direction: 1 | -1): PadState {
  if (state.field === "duration") {
    const next = Math.max(0, (padValue(state) ?? 0) + direction * stepSize(state));
    if (next > Math.min(MAX_DURATION_SECONDS, 999 * 60 + 59)) return state;
    return { ...state, text: durationText(next), replacing: true };
  }
  const limits = limitsOf(state);
  const scale = 10 ** limits.decimals;
  const current = padValue(state) ?? 0;
  const raw = Math.max(0, current + direction * stepSize(state));
  const next = Math.round(raw * scale) / scale;
  if (next >= 10 ** limits.integerDigits) return state;
  return { ...state, text: stripTrailingZeroes(String(next)), replacing: true };
}

/** Whether − can do anything: nothing goes below zero. */
export const canStepDown = (state: PadState): boolean => (padValue(state) ?? 0) > 0;

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
