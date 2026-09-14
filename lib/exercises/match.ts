import { normaliseExerciseName } from "@/appwrite/documents";

/**
 * Ranking the exercise library against what someone has typed.
 *
 * "Type, never hunt" is Ruairi's complaint number two, verbatim: RTS made him
 * hunt through a tree for an exercise he could have spelled in a second. So
 * this has to reward the way people actually type mid-set -- abbreviated
 * ("rdl"), partial ("squa"), or from the middle of the name ("split") -- and it
 * has to do it on the device, because an athlete picking an exercise in a
 * basement gym has no signal and Order 9 says that is normal, not an error.
 *
 * Pure, so every ranking decision below is a test rather than an opinion.
 */

export interface Exercise {
  id: string;
  name: string;
  normalisedName: string;
  isGlobal: boolean;
  ownerId?: string | null;
}

/**
 * How a name matched, strongest first. Kept as an enum rather than folded into
 * one number so a test can say "this matched as an acronym" and mean it.
 */
export type MatchTier = "exact" | "prefix" | "acronym" | "word-prefix" | "substring" | "loose";

const TIER_ORDER: MatchTier[] = ["exact", "prefix", "acronym", "word-prefix", "substring", "loose"];

export interface ExerciseMatch {
  exercise: Exercise;
  tier: MatchTier;
}

/**
 * Below three characters a subsequence match is noise: "s" is a subsequence of
 * almost every exercise in the library, and offering all of them is the
 * 400-item dropdown this feature exists to avoid.
 */
const MIN_LOOSE_QUERY = 3;

/** Default result count. Eight fits a phone without scrolling the list. */
export const MAX_RESULTS = 8;

const initials = (normalised: string) =>
  normalised
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("");

/**
 * Every character of the query appears in order. Catches "bnchprs" and, more
 * usefully, a fat-fingered "bech press" that no prefix rule would forgive.
 */
function isSubsequence(query: string, target: string): boolean {
  let index = 0;
  for (const char of target) {
    if (char === query[index]) index += 1;
    if (index === query.length) return true;
  }
  return false;
}

export function tierFor(query: string, exercise: Exercise): MatchTier | null {
  const q = normaliseExerciseName(query);
  if (!q) return null;
  const name = exercise.normalisedName;

  if (name === q) return "exact";
  if (name.startsWith(q)) return "prefix";

  const compact = name.replace(/ /g, "");
  const acronym = initials(name);
  // Only when the query has no spaces: "back s" is a partial name, not an
  // acronym, and treating it as one ranks nonsense above the obvious answer.
  //
  // Two shapes count. "cgbp" and "bss" are initials outright. "rdl" is not --
  // Romanian Deadlift has two words, so its initials are "rd" and the L comes
  // from inside "deadlift". Lifters write RDL anyway, so a query that starts
  // with the initials and continues through the name in order counts too.
  if (!q.includes(" ") && q.length > 1) {
    if (acronym.startsWith(q)) return "acronym";
    if (q.startsWith(acronym) && isSubsequence(q, compact)) return "acronym";
  }

  if (name.split(" ").some((word) => word.startsWith(q))) return "word-prefix";
  // Two characters minimum. A single letter appears somewhere inside most
  // names in the library -- "s" is in "bench press" -- and offering all of them
  // rebuilds the 400-item dropdown by accident.
  if (q.length > 1 && name.includes(q)) return "substring";
  if (q.length >= MIN_LOOSE_QUERY && isSubsequence(q.replace(/ /g, ""), compact)) {
    return "loose";
  }
  return null;
}

/**
 * Ties break on shorter name, then alphabetically.
 *
 * Deliberately not on recency or how often someone logs a lift: no set data
 * exists until Order 8, and a ranking that changes with use is one nobody can
 * test or predict. Shorter-first means "Squat" beats "Squat, Paused" for a
 * query of "squat", which is the right guess almost every time.
 */
function compare(a: ExerciseMatch, b: ExerciseMatch): number {
  const tier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
  if (tier !== 0) return tier;
  const length = a.exercise.name.length - b.exercise.name.length;
  if (length !== 0) return length;
  return a.exercise.name.localeCompare(b.exercise.name);
}

export function rankExercises(
  query: string,
  exercises: readonly Exercise[],
  limit = MAX_RESULTS,
): ExerciseMatch[] {
  const matches: ExerciseMatch[] = [];
  for (const exercise of exercises) {
    const tier = tierFor(query, exercise);
    if (tier) matches.push({ exercise, tier });
  }
  return matches.sort(compare).slice(0, limit);
}

/**
 * The library as offered before anything is typed.
 *
 * An empty field is the athlete's first moment on this screen, and an empty
 * list there reads as a broken screen. Their own exercises come first: they
 * typed those in mid-session precisely because the library lacked them.
 */
export function defaultExercises(
  exercises: readonly Exercise[],
  limit = MAX_RESULTS,
): Exercise[] {
  return [...exercises]
    .sort((a, b) => {
      if (a.isGlobal !== b.isGlobal) return a.isGlobal ? 1 : -1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

/**
 * The exercise an exact typed name already refers to, if any.
 *
 * `idx_normalised` is a key index, not a unique one, so nothing in Appwrite
 * stops a second "Barbell Row" existing. This is the check that keeps the
 * library from growing a personal duplicate of a row that is already in it --
 * the collision normaliseExerciseName was written to make detectable.
 */
export function findByName(name: string, exercises: readonly Exercise[]): Exercise | null {
  const normalised = normaliseExerciseName(name);
  if (!normalised) return null;
  return (
    exercises.find((e) => e.normalisedName === normalised && e.isGlobal) ??
    exercises.find((e) => e.normalisedName === normalised) ??
    null
  );
}

/** Whether typing this would create something the library does not already hold. */
export function isNewExercise(query: string, exercises: readonly Exercise[]): boolean {
  return Boolean(normaliseExerciseName(query)) && findByName(query, exercises) === null;
}
