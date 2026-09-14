/**
 * Weekly rollups: one row per athlete per exercise per week.
 *
 * Appwrite has no GROUP BY, so every chart, PR and dashboard reads these rather
 * than raw sets. That makes them the only aggregates in the product, and it
 * makes getting them wrong a silent problem -- a wrong rollup looks exactly
 * like a right one.
 *
 * Everything here is pure. The same function computes a bucket when a set
 * lands and when the rebuild script recomputes every bucket from scratch, so
 * the live path and the repair path cannot disagree. That is deliberate: two
 * implementations of an aggregate is how the repair stops repairing.
 *
 * A bucket is always recomputed from its sets, never adjusted incrementally.
 * Incremental is faster and wrong: it cannot survive an undo, a correction, or
 * the same set arriving twice from a retried queue, and a week of one lift is
 * one query of at most a few dozen rows.
 */

export interface RollupSet {
  loadKg: number;
  reps: number;
  isWarmup: boolean;
  /** Null where no honest estimate exists. See lib/strength/e1rm.ts. */
  e1rmKg: number | null;
}

export interface Rollup {
  setCount: number;
  volumeReps: number;
  tonnageKg: number;
  bestE1rmKg: number | null;
  /** The heaviest working set of the week, and what it was done for. */
  bestSingleKg: number | null;
  bestSingleReps: number | null;
}

/**
 * Monday, midnight UTC, of the week containing `date`.
 *
 * Monday because a training week starts on one; UTC because a rollup keyed on
 * the athlete's local week would move when they travel, and a set logged at a
 * Sunday-night session in one timezone must not land in two different weeks
 * depending on where the phone was.
 *
 * [SME to confirm] Ruairi may run weeks Sunday-to-Saturday. It is one constant
 * and the rebuild script re-keys everything, so this is cheap to change.
 */
export function weekStart(date: Date): Date {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay is 0 for Sunday, so Sunday belongs to the week that began six
  // days earlier rather than starting a new one.
  const daysSinceMonday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday);
  return utc;
}

/** The key a set belongs under. Warm-ups included: exclusion happens later. */
export const rollupKey = (athleteId: string, exerciseId: string, loggedAt: Date): string =>
  `${athleteId}/${exerciseId}/${weekStart(loggedAt).toISOString()}`;

/** Rounded to a tenth, like every other stored kilo. Avoids float noise. */
const tenth = (value: number): number => Math.round(value * 10) / 10;

/**
 * One bucket, from its sets.
 *
 * Warm-ups count toward nothing. They are excluded from set count, volume,
 * tonnage and every best -- the same rule the logger's session summary applies,
 * so the week's numbers and the session's numbers agree.
 *
 * [SME to confirm] whether warm-up tonnage should count somewhere. It is real
 * work and some coaches track it; excluding it everywhere is the current rule
 * and the one Ruairi has not been asked about yet.
 */
export function rollupFrom(sets: readonly RollupSet[]): Rollup {
  const working = sets.filter((set) => !set.isWarmup);

  let volumeReps = 0;
  let tonnageKg = 0;
  let bestE1rmKg: number | null = null;
  let bestSingleKg: number | null = null;
  let bestSingleReps: number | null = null;

  for (const set of working) {
    volumeReps += set.reps;
    tonnageKg += set.loadKg * set.reps;

    if (set.e1rmKg !== null && (bestE1rmKg === null || set.e1rmKg > bestE1rmKg)) {
      bestE1rmKg = set.e1rmKg;
    }

    // Heaviest load, and on a tie the one done for more reps -- 140x5 is a
    // better week than 140x3, and a rollup that reported them as the same
    // would flatten exactly the progress an athlete is looking for.
    if (
      bestSingleKg === null ||
      set.loadKg > bestSingleKg ||
      (set.loadKg === bestSingleKg && set.reps > (bestSingleReps ?? 0))
    ) {
      bestSingleKg = set.loadKg;
      bestSingleReps = set.reps;
    }
  }

  return {
    setCount: working.length,
    volumeReps,
    tonnageKg: tenth(tonnageKg),
    bestE1rmKg,
    bestSingleKg,
    bestSingleReps,
  };
}

/** True when a stored rollup already says what the sets say. */
export function rollupMatches(stored: Partial<Rollup>, computed: Rollup): boolean {
  return (
    stored.setCount === computed.setCount &&
    stored.volumeReps === computed.volumeReps &&
    stored.tonnageKg === computed.tonnageKg &&
    (stored.bestE1rmKg ?? null) === computed.bestE1rmKg &&
    (stored.bestSingleKg ?? null) === computed.bestSingleKg &&
    (stored.bestSingleReps ?? null) === computed.bestSingleReps
  );
}
