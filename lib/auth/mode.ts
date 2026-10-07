import { ATHLETE_HOME, COACH_HOME, WELCOME } from "./destinations";

/**
 * Which side of the app someone lands on: a landing preference, not a role.
 *
 * Access still comes from `coach_athlete_links` and nothing else. A user whose
 * mode says "coach" with no athletes linked sees an empty roster and an invite
 * code; a user whose mode says "athlete" with five athletes linked still reads
 * all five the moment they switch. This file decides where to send people and
 * never what they may see.
 *
 * Stored in Appwrite account prefs, not on the profile row. Prefs are the
 * account's own, written only from the account's own session, so there is no
 * provenance question to answer -- and adding a column to `profiles` would put
 * a landing preference where a coach can read it.
 *
 * Pure. Session, store and screens call in here, and the routing table is
 * tested exhaustively without a browser.
 */

export type Mode = "coach" | "athlete";

/** The prefs keys. Namespaced, because prefs are a bag the whole account shares. */
export const MODE_PREF_KEY = "snb_mode";
export const CHOSE_COACH_PREF_KEY = "snb_chose_coach";

export interface ModePrefs {
  /** The side they were on last. Null for an account that has never chosen. */
  mode: Mode | null;
  /**
   * Whether they have ever chosen, or used, coach mode.
   *
   * Separate from `mode` because last-used wins: a coach with no athletes yet
   * who looks at Athlete mode now has mode "athlete", and without this the
   * only way back to their roster would be typing the URL.
   */
  choseCoach: boolean;
}

export const NO_MODE: ModePrefs = { mode: null, choseCoach: false };

export function parseMode(value: unknown): Mode | null {
  return value === "coach" || value === "athlete" ? value : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads the two keys out of whatever prefs came back.
 *
 * Prefs are free-form JSON any session can write for itself, so anything other
 * than the exact values reads as unanswered: "admin" is not a mode, and an
 * unknown value must route like a new account rather than throw on the root.
 */
export function readModePrefs(prefs: unknown): ModePrefs {
  if (!isRecord(prefs)) return NO_MODE;
  const mode = parseMode(prefs[MODE_PREF_KEY]);
  return {
    mode,
    // Choosing coach implies it, so an account with mode "coach" and the flag
    // somehow missing still gets its way back.
    choseCoach: prefs[CHOSE_COACH_PREF_KEY] === true || mode === "coach",
  };
}

/**
 * The prefs object to write: everything already there, plus this mode.
 *
 * `account.updatePrefs` REPLACES the stored object (SDK 26.2 typings: "stored
 * as is, and replaces any previous value"), so writing `{ snb_mode }` alone
 * would wipe anything else on the account. Merged here, from a fresh read.
 */
export function withMode(current: unknown, mode: Mode): Record<string, unknown> {
  const base = isRecord(current) ? current : {};
  const choseCoach = readModePrefs(base).choseCoach || mode === "coach";
  return {
    ...base,
    [MODE_PREF_KEY]: mode,
    ...(choseCoach ? { [CHOSE_COACH_PREF_KEY]: true } : {}),
  };
}

export const homeFor = (mode: Mode): string => (mode === "coach" ? COACH_HOME : ATHLETE_HOME);

export interface LandingInput {
  signedIn: boolean;
  mode: Mode | null;
  /** Whether any athlete is actively linked to them. */
  hasLinks: boolean;
  /** The session came from the device's memory because Appwrite could not be reached. */
  offline: boolean;
}

export interface Landing {
  to: string;
  /** A mode to save silently on the way, for an account that predates the choice. */
  adopt: Mode | null;
}

/**
 * Where the root sends someone.
 *
 * The two no-mode rows are the migration. An account from before this screen
 * existed that already has athletes is a coach by every measure the app had,
 * so it goes to the roster and the choice is saved for it rather than asked.
 * An account with no mode and no athletes has never told us anything, which is
 * what /welcome is for.
 *
 * Offline overrides the welcome: the choice and the profile both need the
 * server, and an athlete opening the app in a basement is better served by a
 * Today screen that works offline than by a form that cannot submit.
 */
export function landingFor(input: LandingInput): Landing {
  if (!input.signedIn) return { to: "/sign-in", adopt: null };
  if (input.mode) return { to: homeFor(input.mode), adopt: null };
  if (input.hasLinks) return { to: COACH_HOME, adopt: input.offline ? null : "coach" };
  if (input.offline) return { to: ATHLETE_HOME, adopt: null };
  return { to: WELCOME, adopt: null };
}

/**
 * What a shell should record when it mounts, or null for nothing.
 *
 * Last-used wins, so the side someone is on is the side they come back to --
 * whether they got there by the toggle or by a link. Written only on a change:
 * a pref write per navigation would be a request per tap for nothing.
 */
export function modeToRecord(saved: ModePrefs, shell: Mode): Mode | null {
  if (saved.mode !== shell) return shell;
  return null;
}

/**
 * Whether the athlete side should offer the way into coach mode.
 *
 * Linked athletes, or ever having chosen coach. Not merely mode "coach": by the
 * time anyone is looking at the athlete side, last-used has already made their
 * mode "athlete".
 */
export const canCoach = (prefs: ModePrefs, hasLinks: boolean): boolean => hasLinks || prefs.choseCoach;
