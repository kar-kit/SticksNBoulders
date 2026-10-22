import { estimateOneRepMax } from "./e1rm";
import type { WeekPoint } from "./lift";
import { weekStart } from "./rollup";

/**
 * Personal records, as the Log sees them: did the set just logged beat
 * everything this athlete had done on this exercise before today?
 *
 * Pure. Two kinds, both already records on Lift Detail:
 *
 * - **e1RM**: the set's estimated one-rep max beats the best estimate ever.
 *   Needs an RPE, like every estimate (lib/strength/e1rm.ts).
 * - **Weight**: the heaviest load ever put on the bar for a working set.
 *
 * Not a third kind, rep PR at a load ("most reps ever at 140"). The rollups
 * keep the week's heaviest set and the week's most reps, each with the other
 * number, but not reps-at-every-load, so a load in between is invisible to
 * them: 140 x 5 in a week whose records were 150 x 1 and 100 x 10 left no
 * trace, and the next 140 x 5 would be called a record it is not. Answering
 * it honestly means a scan of every raw set of the lift, which is not cheap.
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

export type PrKind = "e1rm" | "weight";

export interface PriorBests {
  e1rmKg: number | null;
  heaviestKg: number | null;
}

export interface PriorSet {
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
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
    if (set.isWarmup || set.loggedAt.getTime() >= sessionStart.getTime()) continue;
    if (!usable(set.loadKg) || !(set.reps > 0)) continue;
    any = true;
    const estimate = usable(set.e1rmKg) ? set.e1rmKg : estimateOneRepMax({ ...set, isWarmup: false });
    e1rmKg = higher(e1rmKg, estimate);
    heaviestKg = higher(heaviestKg, set.loadKg);
  }

  return any ? { e1rmKg, heaviestKg } : null;
}

/**
 * Which of a session's sets of ONE exercise are records, and of what.
 *
 * `sets` in the order they were logged. Each working set is measured against
 * the prior best and every set before it today, so 150 then 152.5 over a
 * 147.5 best are both records -- each was, the moment it was lifted -- and a
 * later, lighter set is not. A kind with no prior best (a lift never logged
 * with an RPE has no e1RM to beat) badges nothing of that kind.
 *
 * Warm-ups never count, and neither does an incomplete set.
 */
export function detectPrs(
  sets: readonly SessionSetForPr[],
  bests: PriorBests | null,
): Map<string, PrKind[]> {
  const found = new Map<string, PrKind[]>();
  if (!bests) return found;
  let e1rm = bests.e1rmKg === null ? null : tenth(bests.e1rmKg);
  let heaviest = bests.heaviestKg === null ? null : tenth(bests.heaviestKg);

  for (const set of sets) {
    if (set.isWarmup || !usable(set.loadKg) || !Number.isInteger(set.reps) || set.reps < 1) continue;
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
 */
export function sessionPrs(
  sets: readonly (SessionSetForPr & { exerciseId: string })[],
  found: ReadonlyMap<string, readonly PrKind[]>,
): SessionPr[] {
  const latest = new Map<string, SessionPr>();
  for (const set of sets) {
    for (const kind of found.get(set.clientSetId) ?? []) {
      latest.set(`${set.exerciseId}\u0000${kind}`, {
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
      });
    }
  }
  // Each exercise's records together, in the order the exercises were first
  // trained today, the estimate before the weight.
  const order = [...new Set(sets.map((set) => set.exerciseId))];
  const rank: Record<PrKind, number> = { e1rm: 0, weight: 1 };
  return [...latest.values()].sort(
    (a, b) => order.indexOf(a.exerciseId) - order.indexOf(b.exerciseId) || rank[a.kind] - rank[b.kind],
  );
}
