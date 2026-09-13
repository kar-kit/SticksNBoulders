import type { UnitPreference } from "./types";

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
