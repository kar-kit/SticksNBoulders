/**
 * Athlete View, decided as pure logic.
 *
 * Order 25. The coach's desktop view of one person. Everything here is a rule
 * the screen follows -- who may see the page at all, which lifts get a tab and
 * in what order, which three numbers sit in each row of CURRENT MAXES, how a
 * clip is labelled -- so it is tested without a browser or a network.
 *
 * Nothing in this file aggregates raw sets. The per-lift numbers come from
 * `stats_rollups` and are only reshaped here; the session totals come from the
 * session row. See docs/rollups.md for why.
 */

import { COMPETITION_LIFTS } from "@/lib/strength/dots";
import type { Exercise } from "@/lib/exercises/match";
import type { WeekPoint } from "@/lib/strength/lift";
import type { Comment } from "@/lib/review/comments";
import type { ClipSet } from "@/lib/review/queue";
import {
  preferredMax,
  resolveMaxes,
  type EstimatedInput,
  type MaxKind,
  type ReferenceMaxEntry,
  type ResolvedMax,
  type StoredKind,
} from "@/lib/strength/reference-max";

// --- access ------------------------------------------------------------------

/** A row of `coach_athlete_links`, as the coach can read it. */
export interface CoachLinkRow {
  coachId: string;
  athleteId: string;
  status: "active" | "revoked";
  /** ISO 8601. */
  linkedAt: string | null;
  revokedAt: string | null;
}

export type AthleteAccess =
  /** An active link. The only state in which any of their training is shown. */
  | { kind: "linked"; linkedAt: Date | null }
  /**
   * They were linked and the athlete ended it. A real state with its own
   * screen, not an error: Order 16.6 is explicit that a coach should see
   * "no longer linked" rather than a 401 or a page of empty panels.
   */
  | { kind: "revoked"; revokedAt: Date | null }
  /** Never linked -- a stale URL, a typo, or somebody else's athlete. */
  | { kind: "not-linked" };

const toDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Whether this coach may see this athlete, from `coach_athlete_links`.
 *
 * The link row is the source of truth, not circle membership and not the
 * session's cached athlete list, which was read when the app loaded and does
 * not notice a revoke made since.
 *
 * Rows are re-filtered on both ids rather than trusting the query that fetched
 * them: this decides whether a training history is shown, and a query built
 * slightly wrong must fail closed rather than open.
 *
 * An active row wins over a revoked one. The unique index on the pair means
 * there is at most one row, but a decision about access should not depend on
 * an index staying in place.
 */
export function decideAthleteAccess(
  coachId: string,
  athleteId: string,
  rows: readonly CoachLinkRow[],
): AthleteAccess {
  if (!coachId || !athleteId || coachId === athleteId) return { kind: "not-linked" };

  const mine = rows.filter((row) => row.coachId === coachId && row.athleteId === athleteId);
  const active = mine.find((row) => row.status === "active");
  if (active) return { kind: "linked", linkedAt: toDate(active.linkedAt) };

  const revoked = mine
    .filter((row) => row.status === "revoked")
    .sort((a, b) => (toDate(b.revokedAt)?.getTime() ?? 0) - (toDate(a.revokedAt)?.getTime() ?? 0));
  if (revoked.length > 0) return { kind: "revoked", revokedAt: toDate(revoked[0].revokedAt) };

  return { kind: "not-linked" };
}

// --- lifts -------------------------------------------------------------------

export interface RollupWeek extends WeekPoint {
  exerciseId: string;
}

export interface LiftTab {
  exerciseId: string;
  name: string;
  /** Oldest first. */
  weeks: WeekPoint[];
  lastTrained: Date;
  isCompetition: boolean;
}

/** Shown rather than hidden: a lift with a missing name is still their training. */
export const UNKNOWN_LIFT = "Unknown lift";

/** Competition order, which is how a powerlifting coach reads a lifter. */
const competitionRank = (exercise: Exercise | undefined): number => {
  if (!exercise || !exercise.isGlobal) return -1;
  return (COMPETITION_LIFTS as readonly string[]).indexOf(exercise.normalisedName);
};

/**
 * One tab per lift this athlete has a rollup for.
 *
 * Squat, bench and deadlift first and in that order -- the seeded global rows
 * only, so an athlete's hand-typed "Squat" or a Pause Squat is not promoted --
 * then everything else by most recently trained. That puts what they are doing
 * this block ahead of an accessory they tried once in the spring.
 */
export function liftTabs(weeks: readonly RollupWeek[], exercises: readonly Exercise[]): LiftTab[] {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const grouped = new Map<string, WeekPoint[]>();

  for (const week of weeks) {
    if (!week.exerciseId || Number.isNaN(week.weekStart.getTime())) continue;
    const { exerciseId, ...point } = week;
    grouped.set(exerciseId, [...(grouped.get(exerciseId) ?? []), point]);
  }

  const tabs: LiftTab[] = [...grouped.entries()].map(([exerciseId, points]) => {
    const ordered = [...points].sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
    const exercise = byId.get(exerciseId);
    return {
      exerciseId,
      name: exercise?.name ?? UNKNOWN_LIFT,
      weeks: ordered,
      lastTrained: ordered[ordered.length - 1].weekStart,
      isCompetition: competitionRank(exercise) >= 0,
    };
  });

  return tabs.sort((a, b) => {
    const rankA = competitionRank(byId.get(a.exerciseId));
    const rankB = competitionRank(byId.get(b.exerciseId));
    if (rankA >= 0 || rankB >= 0) {
      if (rankA < 0) return 1;
      if (rankB < 0) return -1;
      return rankA - rankB;
    }
    return b.lastTrained.getTime() - a.lastTrained.getTime() || a.name.localeCompare(b.name);
  });
}

/**
 * The best e1RM per lift and the week it came from, from the same rollups the
 * tabs are drawn from -- the maximum across weeks, so a deload does not lower
 * an estimated max. Mirrors `fetchEstimatedMaxes`.
 */
export function bestEstimates(weeks: readonly RollupWeek[]): Map<string, EstimatedInput> {
  const best = new Map<string, EstimatedInput>();
  for (const week of weeks) {
    const value = week.bestE1rmKg;
    if (value === null || !(value > 0)) continue;
    const current = best.get(week.exerciseId);
    if (!current || value > current.valueKg) {
      best.set(week.exerciseId, { valueKg: value, asOf: week.weekStart.toISOString() });
    }
  }
  return best;
}

// --- current maxes -----------------------------------------------------------

export interface MaxGridRow {
  exerciseId: string;
  exerciseName: string;
  tested: ResolvedMax | null;
  training: ResolvedMax | null;
  estimated: ResolvedMax | null;
  /**
   * Which of the three a percentage with no kind named would use. Shown, so a
   * coach can see which number his programming is actually resolving against.
   */
  usedForPercent: MaxKind | null;
  /**
   * An entry dated in the future, per stored kind. Invisible to `currentMax`
   * until its date -- which is the point, a coach sets next block's max ahead
   * of time -- but a number he has just typed must not simply vanish from the
   * panel he typed it into.
   */
  upcoming: Record<StoredKind, ReferenceMaxEntry | null>;
}

function nextUpcoming(
  entries: readonly ReferenceMaxEntry[],
  kind: StoredKind,
  asOf: Date,
): ReferenceMaxEntry | null {
  const future = entries
    .filter((entry) => entry.kind === kind)
    .filter((entry) => new Date(entry.effectiveFrom).getTime() > asOf.getTime())
    .sort((a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
  return future[0] ?? null;
}

/**
 * The CURRENT MAXES grid: all three kinds side by side, per lift.
 *
 * The blueprint asks for three reference-max types per lift, each with a date
 * and source, so the grid shows every kind rather than only the one
 * `preferredMax` would pick.
 *
 * The three competition lifts are always present, even with nothing in them.
 * That is what makes the empty state actionable: Ruairi's first move with a
 * new athlete is setting a training max on a squat nobody has logged yet, and
 * a grid of only lifts that already have numbers would give him nowhere to
 * type it. Every other lift appears once it has any number at all, in library
 * order (the seeded library is in competition order, see reference-max.ts).
 */
export function maxGrid(
  entries: readonly ReferenceMaxEntry[],
  exercises: readonly Exercise[],
  estimates: ReadonlyMap<string, EstimatedInput>,
  asOf: Date,
): MaxGridRow[] {
  const rows: MaxGridRow[] = [];
  const seen = new Set<string>();

  const push = (exercise: Exercise) => {
    if (seen.has(exercise.id)) return;
    seen.add(exercise.id);
    const mine = entries.filter((entry) => entry.exerciseId === exercise.id);
    const maxes = resolveMaxes(mine, asOf, estimates.get(exercise.id) ?? null);
    rows.push({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      ...maxes,
      usedForPercent: preferredMax(maxes)?.kind ?? null,
      upcoming: {
        tested: nextUpcoming(mine, "tested", asOf),
        training: nextUpcoming(mine, "training", asOf),
      },
    });
  };

  for (const lift of COMPETITION_LIFTS) {
    const exercise = exercises.find((e) => e.isGlobal && e.normalisedName === lift);
    if (exercise) push(exercise);
  }

  for (const exercise of exercises) {
    const hasEntry = entries.some((entry) => entry.exerciseId === exercise.id);
    if (hasEntry || estimates.has(exercise.id)) push(exercise);
  }

  return rows;
}

/**
 * A typed max, as kilos. "182.5", "182,5" and "182.5kg" all mean the same
 * thing to a coach; anything else is refused rather than guessed at, because a
 * guessed max is a wrong weight on a bar. Range checks stay on the server,
 * which owns the plausibility rule and says why in its own words.
 */
export function parseKg(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s*kgs?$/, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Who entered a max, relative to the coach reading it. The blueprint asks for
 * a source on every number, and "set by you" versus "set by them" is the
 * source that matters when two people can both type one in.
 */
export function maxSource(max: ResolvedMax, entries: readonly ReferenceMaxEntry[], viewerId: string, athleteId: string): string {
  if (max.kind === "estimated") return "from logged sets";
  const entry = entries.find((e) => e.id === max.entryId);
  if (!entry) return "";
  if (entry.recordedBy === viewerId) return "set by you";
  if (entry.recordedBy === athleteId) return "set by them";
  return "set by a coach";
}

// --- sessions ----------------------------------------------------------------

export interface BlockSet {
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
}

export interface ExerciseBlock {
  exerciseId: string;
  exerciseName: string;
  sets: BlockSet[];
}

/**
 * One session's sets, grouped by exercise in the order they were worked.
 * Expects sets already ordered by `setsBySession`; this only groups and names.
 */
export function exerciseBlocks(
  sets: readonly (BlockSet & { exerciseId: string })[],
  nameOf: (exerciseId: string) => string | undefined,
): ExerciseBlock[] {
  const blocks: ExerciseBlock[] = [];
  for (const set of sets) {
    let block = blocks.find((b) => b.exerciseId === set.exerciseId);
    if (!block) {
      block = { exerciseId: set.exerciseId, exerciseName: nameOf(set.exerciseId) ?? UNKNOWN_LIFT, sets: [] };
      blocks.push(block);
    }
    block.sets.push({ loadKg: set.loadKg, reps: set.reps, rpe: set.rpe, isWarmup: set.isWarmup });
  }
  return blocks;
}

// --- videos ------------------------------------------------------------------

export interface VideoRow extends ClipSet {
  exerciseName: string;
  /** This coach has cleared it in the Review Queue. Per coach, like the queue. */
  reviewed: boolean;
  commentCount: number;
}

/**
 * Every clip this athlete has filmed, newest first -- the opposite of the
 * queue's oldest-first, because the queue is for clearing and this is for
 * reading back what someone has been doing lately.
 */
export function videoRows(
  clips: readonly ClipSet[],
  reviewedSetIds: ReadonlySet<string>,
  comments: readonly Comment[],
  nameOf: (exerciseId: string) => string | undefined,
): VideoRow[] {
  const counts = new Map<string, number>();
  for (const comment of comments) counts.set(comment.setId, (counts.get(comment.setId) ?? 0) + 1);

  const time = (iso: string) => {
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };

  return [...clips]
    .sort((a, b) => time(b.loggedAt) - time(a.loggedAt))
    .map((clip) => ({
      ...clip,
      exerciseName: nameOf(clip.exerciseId) ?? UNKNOWN_LIFT,
      reviewed: reviewedSetIds.has(clip.id),
      commentCount: counts.get(clip.id) ?? 0,
    }));
}

// --- labels ------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Sep", or "12 Sep 2025" when it is not this year. */
export function shortDate(date: Date | null, now: Date = new Date()): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}
