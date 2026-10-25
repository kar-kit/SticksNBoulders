import { estimateOneRepMax } from "./e1rm";
import type { WeekPoint } from "./lift";
import { weekStart } from "./rollup";

/**
 * Personal records, as the Log sees them: did the set just logged beat
 * everything this athlete had done on this exercise before today?
 *
 * Pure. Three kinds. The first two are already records on Lift Detail:
 *
 * - **e1RM**: the set's estimated one-rep max beats the best estimate ever.
 *   Needs an RPE of 6 or more, like every estimate (lib/strength/e1rm.ts,
 *   `MIN_ESTIMABLE_RPE`): a set logged "Under 6" can never be one.
 * - **Weight**: the heaviest load ever put on the bar for a working set.
 * - **Reps**: more reps than ever at this load or heavier. 140 x 6 over a
 *   prior 140 x 5 is one, and so is 140 x 6 when the most at 140 or more was
 *   142.5 x 5; a prior 142.5 x 6 blocks it, because doing six with more on
 *   the bar already said six at 140 was in there. That is how a coach's
 *   rep-max table reads, and unlike "exactly this load" it does not call a
 *   back-off at a weight never used before a record just for being new. It needs something at this load or heavier
 *   to beat: a set heavier than anything before is a weight record, not
 *   also a rep record by beating zero.
 *
 * ## Sets logged below RPE 6
 *
 * They lose the e1RM record and keep the other two. A weight record and a
 * rep record are facts about what was on the bar and how many times it moved,
 * and neither reads the RPE: 140 x 8 is eight reps at 140 whether the athlete
 * called it a 9 or a 4, and if anything an easy one is the more impressive.
 * Only the estimate depends on how close to failure the set was, so only the
 * estimate is withheld. The rollups agree by construction: their heaviest set
 * and most reps never read RPE either, and their best e1RM reads the stored
 * `e1rm_kg`, which is null for these sets.
 *
 * ## Failed sets (F19)
 *
 * Never a record of any kind, and never a best to beat. A miss at 200 is not
 * the heaviest weight lifted, 3 of a failed 5 at 140 is not a rep max, and
 * a failed set has no e1RM (lib/strength/e1rm.ts). So `priorBests` and
 * `repBests` skip them, which is also what keeps the Log's device cache
 * (`snb.exercise-history`) clean: it stores those two answers, not the
 * sets. `detectPrs` badges none and lets none into the session's running
 * frontier or heaviest weight, so a failed 150 does not make a made 150
 * after it look like a non-record. The rollups agree: `rollupFrom` keeps
 * failed sets out of its bests (lib/strength/rollup.ts).
 *
 * ## Why the rep record reads raw sets
 *
 * The rollups keep the week's heaviest set and the week's most reps, each
 * with the other number, but not reps-at-every-load, so a load in between is
 * invisible to them: 140 x 5 in a week whose records were 150 x 1 and
 * 100 x 10 left no trace, and the next 140 x 5 would be called a record it
 * is not. So the rep record is measured against every raw working set of the
 * lift (`repBests`), read once per session by the Log
 * (lib/logging/exercise-history-store.ts) and boiled down to its frontier,
 * the few (load, reps) pairs no other set beats on both. When that read
 * cannot reach the lift's first set, there is no rep record to beat and none
 * is badged: half a history would call old rep maxes new.
 *
 * ## "Before this session", and why it is not just the rollups
 *
 * `stats_rollups` is refreshed behind every set write, so the current week's
 * row starts to include this session's own sets as they sync. Comparing a
 * set against a best that already contains it would never call it a record
 * (or, reading the rollup before and after a sync, would call it one twice).
 * So the bests are frozen at the session's start:
 *
 * - every rollup week strictly before the session's week (it cannot hold a
 *   set from a session that started later), and
 * - raw sets logged before the session started, which covers the earlier
 *   days of this week. Including raw sets from older weeks too is harmless:
 *   a maximum does not mind seeing the same set twice.
 *
 * Nothing about that changes as the session's sets sync, so a reload gives
 * the same badges on the same sets.
 */

export type PrKind = "e1rm" | "weight" | "reps";

/** A point of the rep-max frontier: at `loadKg` or heavier, `reps` at most. */
export interface RepBest {
  loadKg: number;
  reps: number;
}

export interface PriorBests {
  e1rmKg: number | null;
  heaviestKg: number | null;
  /**
   * The rep-max frontier before the session, heaviest first (`repBests`).
   * Absent or null when the whole history was not read: no rep records then.
   */
  repsAt?: readonly RepBest[] | null;
}

export interface PriorSet {
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /** F19. Absent reads as false. */
  failed?: boolean;
  loggedAt: Date;
  /** As stored on the set. Recomputed from load, reps and RPE when absent. */
  e1rmKg?: number | null;
}

export interface SessionSetForPr {
  clientSetId: string;
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /** F19. Absent reads as false. */
  failed?: boolean;
}

/**
 * Compared at a tenth of a kilo, the precision every stored kilo is rounded
 * to. That also absorbs float noise from pounds: 315 lb is stored as
 * 142.882 kg every time it is typed, and reads back as itself rather than as
 * a record by a millionth.
 */
const tenth = (kg: number): number => Math.round(kg * 10) / 10;

const usable = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const higher = (a: number | null, b: number | null | undefined): number | null =>
  usable(b) && (a === null || b > a) ? b : a;

/**
 * The bests to beat, as they stood when the session started. Null when the
 * athlete has no working set of this exercise on record at all: the first
 * time a lift is logged, every set would be a "record", and a badge on all of
 * them says nothing.
 */
export function priorBests(
  weeks: readonly WeekPoint[],
  before: readonly PriorSet[],
  sessionStart: Date,
): PriorBests | null {
  const thisWeek = weekStart(sessionStart).getTime();
  let e1rmKg: number | null = null;
  let heaviestKg: number | null = null;
  let any = false;

  for (const week of weeks) {
    if (week.weekStart.getTime() >= thisWeek) continue;
    if (usable(week.bestSingleKg) || usable(week.bestE1rmKg)) any = true;
    e1rmKg = higher(e1rmKg, week.bestE1rmKg);
    heaviestKg = higher(heaviestKg, week.bestSingleKg);
  }

  for (const set of before) {
    if (set.isWarmup || set.failed || set.loggedAt.getTime() >= sessionStart.getTime()) continue;
    if (!usable(set.loadKg) || !(set.reps > 0)) continue;
    any = true;
    const estimate = usable(set.e1rmKg) ? set.e1rmKg : estimateOneRepMax({ ...set, isWarmup: false });
    e1rmKg = higher(e1rmKg, estimate);
    heaviestKg = higher(heaviestKg, set.loadKg);
  }

  return any ? { e1rmKg, heaviestKg } : null;
}

/**
 * The rep-max frontier of working sets logged before `sessionStart`: per
 * load, at a tenth of a kilo, the most reps done at that load or heavier,
 * kept only where it is more than at any heavier load. Heaviest first, so
 * reps strictly rise down the list. A long history boils down to a few dozen
 * points at most, which is what the device keeps for the session.
 *
 * Only meaningful over the lift's whole history; see the header.
 */
export function repBests(before: readonly PriorSet[], sessionStart: Date): RepBest[] {
  const mostAt = new Map<number, number>();
  for (const set of before) {
    if (set.isWarmup || set.failed || set.loggedAt.getTime() >= sessionStart.getTime()) continue;
    if (!usable(set.loadKg) || !Number.isInteger(set.reps) || set.reps < 1) continue;
    const load = tenth(set.loadKg);
    mostAt.set(load, Math.max(mostAt.get(load) ?? 0, set.reps));
  }
  return frontierOf([...mostAt].map(([loadKg, reps]) => ({ loadKg, reps })));
}

/** Pareto frontier, heaviest first: drops every point another beats or ties on both load and reps. */
function frontierOf(points: readonly RepBest[]): RepBest[] {
  const sorted = [...points].sort((a, b) => b.loadKg - a.loadKg || b.reps - a.reps);
  const kept: RepBest[] = [];
  for (const point of sorted) {
    if (point.reps > (kept.at(-1)?.reps ?? 0)) kept.push(point);
  }
  return kept;
}

/** The most reps on the frontier at `load` or heavier; 0 when nothing that heavy was ever lifted. */
function mostRepsAtOrAbove(frontier: readonly RepBest[], load: number): number {
  let most = 0;
  for (const point of frontier) {
    if (point.loadKg < load) break;
    most = Math.max(most, point.reps);
  }
  return most;
}

/**
 * Which of a session's sets of ONE exercise are records, and of what.
 *
 * `sets` in the order they were logged. Each working set is measured against
 * the prior best and every set before it today, so 150 then 152.5 over a
 * 147.5 best are both records -- each was, the moment it was lifted -- and a
 * later, lighter set is not. Likewise 140 x 6 then 140 x 7 over a prior
 * 140 x 5 are both rep records, and a second 140 x 7 is not. A kind with no
 * prior best (a lift never logged with an RPE has no e1RM to beat; a history
 * not read in full has no rep frontier) badges nothing of that kind.
 *
 * Warm-ups never count, and neither does an incomplete set or a failed one
 * (F19): no badge, and no place in the running bests a later set is measured
 * against.
 */
export function detectPrs(
  sets: readonly SessionSetForPr[],
  bests: PriorBests | null,
): Map<string, PrKind[]> {
  const found = new Map<string, PrKind[]>();
  if (!bests) return found;
  let e1rm = bests.e1rmKg === null ? null : tenth(bests.e1rmKg);
  let heaviest = bests.heaviestKg === null ? null : tenth(bests.heaviestKg);
  let frontier = bests.repsAt ? frontierOf(bests.repsAt.map((p) => ({ loadKg: tenth(p.loadKg), reps: p.reps }))) : null;

  for (const set of sets) {
    if (set.isWarmup || set.failed || !usable(set.loadKg) || !Number.isInteger(set.reps) || set.reps < 1) continue;
    const kinds: PrKind[] = [];

    const estimate = estimateOneRepMax({ loadKg: set.loadKg, reps: set.reps, rpe: set.rpe, isWarmup: false });
    if (estimate !== null && e1rm !== null && tenth(estimate) > e1rm) {
      kinds.push("e1rm");
      e1rm = tenth(estimate);
    }

    const load = tenth(set.loadKg);
    if (heaviest !== null && load > heaviest) {
      kinds.push("weight");
      heaviest = load;
    }

    if (frontier !== null) {
      const most = mostRepsAtOrAbove(frontier, load);
      if (most > 0 && set.reps > most) kinds.push("reps");
      // Every working set joins the frontier, record or not: 140 x 6 today
      // is what a later 140 x 6 has to beat.
      if (set.reps > most) frontier = frontierOf([...frontier, { loadKg: load, reps: set.reps }]);
    }

    if (kinds.length > 0) found.set(set.clientSetId, kinds);
  }
  return found;
}

export interface SessionPr {
  exerciseId: string;
  kind: PrKind;
  clientSetId: string;
  loadKg: number;
  reps: number;
  rpe: number | null;
  /** The estimate, for an e1RM record. */
  e1rmKg: number | null;
}

/**
 * The records to list on the finish screen: per exercise, per kind, the one
 * that stood at the end. Two e1RM records on the squat today are one line,
 * the better one, not two.
 *
 * Rep records are per load rather than per exercise: 140 x 6 and 120 x 10
 * are two different records, and keeping only one would hide the other. A
 * rep record that a later one today covers -- as many reps or more at as
 * heavy a load or heavier, so 140 x 6 then 140 x 7, or 140 x 6 then
 * 142.5 x 6 -- folds into it, which also leaves one line per load. Heaviest
 * first.
 */
export function sessionPrs(
  sets: readonly (SessionSetForPr & { exerciseId: string })[],
  found: ReadonlyMap<string, readonly PrKind[]>,
): SessionPr[] {
  const latest = new Map<string, SessionPr>();
  const reps: SessionPr[] = [];
  for (const set of sets) {
    for (const kind of found.get(set.clientSetId) ?? []) {
      const record: SessionPr = {
        exerciseId: set.exerciseId,
        kind,
        clientSetId: set.clientSetId,
        loadKg: set.loadKg,
        reps: set.reps,
        rpe: set.rpe,
        e1rmKg:
          kind === "e1rm"
            ? estimateOneRepMax({ loadKg: set.loadKg, reps: set.reps, rpe: set.rpe, isWarmup: false })
            : null,
      };
      if (kind === "reps") reps.push(record);
      else latest.set(`${set.exerciseId}\u0000${kind}`, record);
    }
  }
  const covers = (a: SessionPr, b: SessionPr) =>
    a !== b && a.exerciseId === b.exerciseId && tenth(a.loadKg) >= tenth(b.loadKg) && a.reps >= b.reps;
  const standing = reps.filter((record) => !reps.some((other) => covers(other, record)));

  // Each exercise's records together, in the order the exercises were first
  // trained today, the estimate before the weight before the reps.
  const order = [...new Set(sets.map((set) => set.exerciseId))];
  const rank: Record<PrKind, number> = { e1rm: 0, weight: 1, reps: 2 };
  return [...latest.values(), ...standing].sort(
    (a, b) =>
      order.indexOf(a.exerciseId) - order.indexOf(b.exerciseId) ||
      rank[a.kind] - rank[b.kind] ||
      b.loadKg - a.loadKg,
  );
}
