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
  /** The most reps in one working set that week, and what it was done with. */
  bestReps: number | null;
  bestRepsLoadKg: number | null;
}

/**
 * The timezone that decides which week a set belongs to.
 *
 * Joey's call, 14 Sep 2026: the gym is in the UK and a training week runs
 * Monday to Sunday.
 *
 * This is emphatically not the same as storing times in UTC, which the product
 * does and should -- `logged_at` is an instant. It is about which calendar week
 * an instant falls in, and in the UK that is not a question UTC can answer.
 * Under BST, roughly seven months of the year, a set logged at 00:30 on a
 * Monday morning is 23:30 UTC on the Sunday, so a UTC-only rule files it in the
 * week that just ended. Checked against the live clock, not assumed:
 *
 *     2026-09-13T23:30:00Z  ->  Monday 14 Sep 00:30 BST  ->  UTC rule says w/c 7 Sep
 *
 * One hour every Monday, for most of the year, landing in last week's volume.
 * Deciding membership in London time and labelling the week by its local
 * calendar date fixes it, and stays deterministic -- the rebuild script derives
 * the same answer from the same stored instant, forever.
 *
 * [SME to confirm] the day itself. Joey confirmed Monday to Sunday; if Ruairi
 * runs Sunday to Saturday it is one constant here and a rebuild run.
 */
export const WEEK_TIME_ZONE = "Europe/London";

/** The year, month and day `date` falls on in that timezone. */
function localYmd(date: Date, timeZone: string): [number, number, number] {
  // en-CA formats as YYYY-MM-DD, which is the one locale that needs no parsing
  // of month names and no assumptions about day/month order.
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [year, month, day] = text.split("-").map(Number);
  return [year, month, day];
}

/**
 * The Monday of the week containing `date`, as a UTC midnight.
 *
 * The returned value is a label rather than an instant: "the week beginning
 * Monday 14 September". Storing it as the local midnight would make week_start
 * jump by an hour across the BST boundary and put a Sunday 23:00 timestamp in a
 * column every human reading the database expects to be a Monday.
 */
export function weekStart(date: Date, timeZone: string = WEEK_TIME_ZONE): Date {
  let ymd: [number, number, number];
  try {
    ymd = localYmd(date, timeZone);
  } catch {
    // An unknown zone, or an environment built without full ICU. Falling back
    // to UTC is off by at most an hour; throwing would lose the set entirely.
    ymd = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  }

  const [year, month, day] = ymd;
  const monday = new Date(Date.UTC(year, month - 1, day));
  // getUTCDay is 0 for Sunday, so Sunday belongs to the week that began six
  // days earlier rather than starting a new one.
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday;
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
  let bestReps: number | null = null;
  let bestRepsLoadKg: number | null = null;

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

    // Most reps, and on a tie the heavier one: 100x12 beats 60x12, and a rep
    // record that ignored the weight would reward the lightest set of the week.
    if (
      bestReps === null ||
      set.reps > bestReps ||
      (set.reps === bestReps && set.loadKg > (bestRepsLoadKg ?? 0))
    ) {
      bestReps = set.reps;
      bestRepsLoadKg = set.loadKg;
    }
  }

  return {
    setCount: working.length,
    volumeReps,
    tonnageKg: tenth(tonnageKg),
    bestE1rmKg,
    bestSingleKg,
    bestSingleReps,
    bestReps,
    bestRepsLoadKg,
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
    (stored.bestSingleReps ?? null) === computed.bestSingleReps &&
    (stored.bestReps ?? null) === computed.bestReps &&
    (stored.bestRepsLoadKg ?? null) === computed.bestRepsLoadKg
  );
}
