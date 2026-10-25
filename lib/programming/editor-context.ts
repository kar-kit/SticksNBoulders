import { mondayOf } from "./calendar";
import { localDay } from "./program";
import { videoRows, type VideoRow } from "@/lib/coach/athlete-view";
import type { ClipSet } from "@/lib/review/queue";

/**
 * The Program Editor's context drawer, as pure logic: what the athlete did
 * the last week they did each exercise on screen, and which of their clips
 * this coach has not watched yet. Ruairi writes the next week after watching
 * the last one's videos (the research brief, Oct 2026); this puts that
 * evidence beside the page instead of in another tab.
 *
 * Read-only, and built from rows the app already reads for Athlete View and
 * the Review Queue. Nothing here aggregates for a dashboard -- it is one
 * athlete's last few sessions, shown as logged, which is the case
 * docs/rollups.md allows raw sets for.
 */

/** A logged set, as `fetchSetsForSessions` returns it. */
export interface ContextSet {
  exerciseId: string;
  sessionId: string;
  setIndex: number;
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /** F19: a missed set. Said in words, so the coach never reads it as made. */
  failed?: boolean;
  loggedAt: Date;
}

export interface LastWeekSession {
  /** The calendar day it was logged, in the coach's timezone. */
  day: string;
  /** "180 × 3 @8, 165 × 5 @7.5 ×3". */
  sets: string;
}

export interface LastWeek {
  exerciseId: string;
  /** The Monday of the week it was last done. */
  weekOf: string;
  sessions: LastWeekSession[];
}

const kg = (value: number) => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))));

/**
 * One session's sets of one exercise, in words, with straight sets folded:
 * "165 × 5 @7.5 ×3" is three identical sets, the way a coach writes them.
 * Only consecutive repeats fold, so a top set between two backoffs stays put.
 * A missed set (F19) reads "200 × 0 @10 failed", and never folds into a made
 * one at the same numbers.
 */
export function setsInWords(sets: readonly Pick<ContextSet, "loadKg" | "reps" | "rpe" | "failed">[]): string {
  const parts: { text: string; count: number }[] = [];
  for (const set of sets) {
    const text = `${kg(set.loadKg)} × ${set.reps}${set.rpe === null ? "" : ` @${kg(set.rpe)}`}${set.failed ? " failed" : ""}`;
    const last = parts.at(-1);
    if (last?.text === text) last.count += 1;
    else parts.push({ text, count: 1 });
  }
  return parts.map((p) => (p.count > 1 ? `${p.text} ×${p.count}` : p.text)).join(", ");
}

/**
 * For each exercise on screen, the most recent Monday-to-Sunday in which the
 * athlete logged a working set of it, and every session of it that week.
 *
 * Per exercise, not one week for the lot: an athlete who benched on Thursday
 * and has not squatted since last Monday should show both, each from its own
 * last week. Warm-ups are left out -- they say nothing about where the work
 * is. An exercise not found in the sets read (the newest 25 sessions) is left
 * out rather than shown as "never": the read is a window, not the history.
 */
export function lastLoggedWeeks(sets: readonly ContextSet[], exerciseIds: readonly string[]): LastWeek[] {
  const out: LastWeek[] = [];
  for (const exerciseId of exerciseIds) {
    const mine = sets.filter((s) => s.exerciseId === exerciseId && !s.isWarmup && !Number.isNaN(s.loggedAt.getTime()));
    if (mine.length === 0) continue;
    const latest = mine.reduce((a, b) => (b.loggedAt > a.loggedAt ? b : a));
    const weekOf = mondayOf(localDay(latest.loggedAt));
    const inWeek = mine
      .filter((s) => mondayOf(localDay(s.loggedAt)) === weekOf)
      .sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime() || a.setIndex - b.setIndex);
    const bySession = new Map<string, ContextSet[]>();
    for (const set of inWeek) bySession.set(set.sessionId, [...(bySession.get(set.sessionId) ?? []), set]);
    out.push({
      exerciseId,
      weekOf,
      sessions: [...bySession.values()].map((group) => ({ day: localDay(group[0].loggedAt), sets: setsInWords(group) })),
    });
  }
  return out;
}

/**
 * The athlete's clips this coach has not cleared, newest first: the Review
 * Queue's own definition of waiting (cleared is per coach), read back the way
 * Athlete View lists them. `total` is every waiting clip; `rows` the first few.
 */
export function waitingClips(
  clips: readonly ClipSet[],
  reviewedSetIds: ReadonlySet<string>,
  nameOf: (exerciseId: string) => string | undefined,
  limit = 5,
): { total: number; rows: VideoRow[] } {
  const waiting = videoRows(clips, reviewedSetIds, [], nameOf).filter((row) => !row.reviewed);
  return { total: waiting.length, rows: waiting.slice(0, limit) };
}
