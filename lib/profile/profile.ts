/**
 * The profile: who someone is, and the two facts their numbers depend on.
 *
 * Pure. The interesting part is not the fields but what is allowed to be
 * missing, and what the product does about it -- which is testable without a
 * browser and is where a silent DOTS failure would otherwise come from.
 */

export type Sex = "male" | "female";
export type Units = "kg" | "lb";

export interface Profile {
  userId: string;
  displayName: string;
  /** Null until answered. See `needsSex` for why that is not simply a bug. */
  sex: Sex | null;
  units: Units;
}

/**
 * Both values, in the order the picker shows them.
 *
 * Two options because DOTS has two coefficient sets, and this field exists to
 * choose between them. It is not a question about identity and the screen says
 * so: an athlete for whom neither is right can leave it unset and lose DOTS,
 * which is a fair trade and better than a third option that silently picks one
 * of the two formulas anyway.
 */
export const SEX_OPTIONS: readonly Sex[] = ["male", "female"];
export const UNIT_OPTIONS: readonly Units[] = ["kg", "lb"];

export const sexLabel = (sex: Sex | null): string =>
  sex === "male" ? "Male" : sex === "female" ? "Female" : "Not set";

export const unitLabel = (units: Units): string => (units === "kg" ? "Kilograms" : "Pounds");

/** Everything stored is in kilograms; this is a display preference only. */
export const DEFAULT_UNITS: Units = "kg";

export function isSex(value: unknown): value is Sex {
  return value === "male" || value === "female";
}

export function isUnits(value: unknown): value is Units {
  return value === "kg" || value === "lb";
}

/**
 * Longest a display name may be, matching `profiles.display_name` in the
 * schema. Names are shown in a coach's rail beside seven others, so this is a
 * layout limit as much as a storage one.
 */
export const MAX_NAME_LENGTH = 64;

export type NameRejection =
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "too-long"; over: number };

export function checkDisplayName(raw: string): { ok: true; name: string } | NameRejection {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) return { ok: false, reason: "empty" };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: "too-long", over: name.length - MAX_NAME_LENGTH };
  }
  return { ok: true, name };
}

export function nameRejectionMessage(rejection: NameRejection): string {
  return rejection.reason === "empty"
    ? "Your coach needs something to call you."
    : `That's ${rejection.over} characters too long.`;
}

/**
 * Whether to ask for sex, and it is deliberately not the same as "sex is null".
 *
 * The blueprint says sex is required because the DOTS coefficients differ and
 * there is no sensible default. The schema says the column is nullable. Both
 * are right, and this function is where they meet: storage permits the absence,
 * the product asks anyway, and nothing downstream is allowed to guess.
 *
 * The column stays nullable on purpose. Every profile backfilled onto an
 * existing account starts without an answer, and a required column would
 * refuse to write them at all -- turning a missing number into a missing
 * athlete.
 */
export const needsSex = (profile: Profile | null): boolean =>
  profile !== null && profile.sex === null;

/**
 * What a name falls back to when nobody has set one.
 *
 * Their Appwrite account name, then the local part of their email, then a word
 * rather than a user id. A coach's rail showing a hex string is worse than one
 * showing "Athlete", and an email address in front of a third party is worse
 * than both.
 */
export function fallbackName(accountName: string, email: string): string {
  const named = accountName.trim();
  if (named) return named.slice(0, MAX_NAME_LENGTH);
  const local = email.split("@")[0]?.trim() ?? "";
  if (local) return local.slice(0, MAX_NAME_LENGTH);
  return "Athlete";
}
