export type UnitPreference = "kg" | "lb";

const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Convert a stored kg value to the user's display unit, rounded to a sane precision. */
export function displayWeight(kg: number, unit: UnitPreference): number {
  const value = unit === "lb" ? kgToLb(kg) : kg;
  return Math.round(value * 10) / 10;
}

/** Convert a value the user typed in their display unit back to kg for storage. */
export function toKg(value: number, unit: UnitPreference): number {
  return unit === "lb" ? lbToKg(value) : value;
}

export function formatWeight(kg: number, unit: UnitPreference): string {
  return `${displayWeight(kg, unit)} ${unit}`;
}

/* -------------------------------------------------------------------------
 * Loads: the bar, as the athlete types it and reads it back.
 *
 * Storage is kilograms everywhere, always. The unit is a display preference,
 * applied at exactly two boundaries: a number typed becomes kilos on its way
 * in (`loadFromInput`), and kilos become the athlete's unit on their way out
 * (`loadIn`). Nothing between those two ever sees a pound.
 *
 * The precisions are chosen so the two are inverses for anything the pad will
 * accept. Pounds are typed to one decimal and shown to one decimal; stored
 * kilos are rounded to the gram. A gram is 0.0022 lb, far inside the 0.05 lb
 * that would move a one-decimal display, so 225 lb typed is 225 lb read back,
 * on every device, after any number of reloads. Kilograms keep the two
 * decimals the logger has always shown, untouched.
 * ---------------------------------------------------------------------- */

/** Decimals a typed load may carry. Pound totals move in 0.5s even on micro-plates. */
export const LOAD_DECIMALS: Record<UnitPreference, number> = { kg: 2, lb: 1 };

const roundTo = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

/** A stored kilo value as the number the athlete reads, in their unit. */
export function loadIn(kg: number, unit: UnitPreference): number {
  return roundTo(unit === "lb" ? kgToLb(kg) : kg, LOAD_DECIMALS[unit]);
}

/**
 * A number the athlete typed in their unit, as the kilos to store.
 *
 * Kilograms pass through exactly as typed. Pounds are rounded to the gram: no
 * scale or plate is more precise, and it keeps an export from reading
 * 102.05828325.
 */
export function loadFromInput(value: number, unit: UnitPreference): number {
  return unit === "lb" ? roundTo(lbToKg(value), 3) : value;
}

/** "142.5", "225": a load in the athlete's unit, trailing zeroes trimmed, no suffix. */
export function loadNumber(kg: number, unit: UnitPreference): string {
  return String(loadIn(kg, unit));
}

/** "142.5 kg", "225 lb". */
export function loadLabel(kg: number, unit: UnitPreference): string {
  return `${loadNumber(kg, unit)} ${unit}`;
}

/** The unit as a word, for labels a screen reader speaks. */
export const unitName = (unit: UnitPreference): string => (unit === "lb" ? "pounds" : "kilograms");
