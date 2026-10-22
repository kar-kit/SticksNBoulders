import { normaliseExerciseName } from "@/appwrite/documents";

/**
 * Sibling variants: the same movement done with a different implement.
 *
 * The library has no equipment field. A variation is its own exercise (see
 * the header of seed.ts), so "Dumbbell Front Raise", "Cable Front Raise" and
 * "Plate Front Raise" are three rows with nothing linking them but their
 * names. When a coach leaves the implement open -- or the cable stack is
 * taken -- the athlete needs the other two one tap away, without a modifier
 * system nobody agreed to.
 *
 * So siblings are read off the names: strip one leading implement word and
 * compare what is left. "Barbell Row" and "Dumbbell Row" are both "row"; "Lateral Raise"
 * (no implement) and "Cable Lateral Raise" are both "lateral raise".
 *
 * Deliberately narrow:
 *   - Only a LEADING implement counts. "Seated Cable Row" is its own
 *     movement, not a cable "Seated Row".
 *   - Specialty bars (safety bar, trap bar, cambered) are not implements
 *     here. A Safety Bar Squat is a variation with its own max, not the comp
 *     squat with a different handle. [Inference] -- Joey/Ruairi to confirm.
 *   - Two names with the same implement (or the same name) are spellings of
 *     one exercise, not variants of each other, so they are never offered.
 *
 * Pure. Matching is on the normalised name, the same form the library and
 * the typeahead use.
 */

/**
 * Implement words, normalised, mapped to a canonical implement. Longest
 * spellings are tried first, so "smith machine" beats "smith" and
 * "ez bar" beats "ez".
 */
const IMPLEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["smith machine", "smith"],
  ["ez curl bar", "ez bar"],
  ["ez bar", "ez bar"],
  ["ezbar", "ez bar"],
  ["barbell", "barbell"],
  ["bb", "barbell"],
  ["dumbbells", "dumbbell"],
  ["dumbbell", "dumbbell"],
  ["db", "dumbbell"],
  ["cable", "cable"],
  ["plate", "plate"],
  ["machine", "machine"],
  ["smith", "smith"],
  ["kettlebells", "kettlebell"],
  ["kettlebell", "kettlebell"],
  ["kb", "kettlebell"],
  ["band", "band"],
  ["banded", "band"],
  ["landmine", "landmine"],
];

export interface VariantKey {
  /** The canonical implement, or null for a bare name ("Lateral Raise"). */
  implement: string | null;
  /** What is left once the implement is stripped: the movement. */
  movement: string;
}

/** Splits a name into its leading implement (if any) and the movement. */
export function variantKey(name: string): VariantKey {
  const normalised = normaliseExerciseName(name);
  for (const [word, canonical] of IMPLEMENTS) {
    if (normalised.startsWith(`${word} `)) {
      const movement = normalised.slice(word.length + 1).trim();
      if (movement) return { implement: canonical, movement };
    }
  }
  return { implement: null, movement: normalised };
}

export interface NamedExercise {
  id: string;
  name: string;
}

/**
 * Every exercise in `library` that is the same movement as `exercise` with a
 * different implement, sorted by name. Never includes `exercise` itself, an
 * exact duplicate spelling, or a row on the same implement.
 *
 * A bare name and an implemented one are siblings ("Lateral Raise" and
 * "Cable Lateral Raise"); two bare names never are -- with nothing stripped,
 * "same movement" would just mean "same name".
 */
export function siblingVariants<T extends NamedExercise>(exercise: NamedExercise, library: readonly T[]): T[] {
  const mine = variantKey(exercise.name);
  if (!mine.movement) return [];
  const own = normaliseExerciseName(exercise.name);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const other of library) {
    if (other.id === exercise.id) continue;
    const theirs = variantKey(other.name);
    if (theirs.movement !== mine.movement) continue;
    if (theirs.implement === mine.implement) continue;
    const normalised = normaliseExerciseName(other.name);
    if (normalised === own || seen.has(normalised)) continue;
    seen.add(normalised);
    out.push(other);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the Swap sheet lists for a block: the coach's pick first (when there is
 * one and it is not the only thing there), then its siblings. For a free
 * block the "pick" is just the exercise the block started as.
 *
 * Siblings are found from the coach's pick, not from whatever is in hand, so
 * swapping Barbell Row to Dumbbell Row and back to Barbell Row always offers
 * the same list in the same order. `exclude` drops exercises that already
 * have a block of their own this session, so one exercise never ends up in
 * two blocks.
 */
export function swapOptions<T extends NamedExercise>(
  pick: T,
  library: readonly T[],
  exclude: ReadonlySet<string> = new Set(),
): T[] {
  const siblings = siblingVariants(pick, library).filter((e) => !exclude.has(e.id));
  return siblings.length === 0 ? [] : [pick, ...siblings];
}
