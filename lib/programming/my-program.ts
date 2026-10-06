import {
  assembleProgram,
  type Prescription,
  type Program,
  type ProgramBlock,
  type ProgramDay,
  type ProgramTree,
  type ProgramWeek,
  type WeekTree,
} from "./program";
import type { SessionRecord } from "@/lib/logging/session";

/**
 * My Program, the athlete's read-only view of their block. Order 23.
 *
 * Pure. The rules for what the athlete may see, and which state each day is
 * in, live here so the screen is only drawing. Nothing in this file writes,
 * and nothing in it trusts the UI to hide a draft: `visibleProgram` is what
 * the fetch layer calls before anything is returned or cached.
 */

/** Programs the athlete may be shown, newest first. Draft and archived never. */
export function livePrograms(programs: readonly Program[], athleteId: string): Program[] {
  return programs
    .filter((p) => p.athleteId === athleteId && p.status === "published")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A week the athlete may see: published, in a published program. */
export function isVisibleWeek(program: Program, week: ProgramWeek): boolean {
  return program.status === "published" && week.programId === program.id && week.status === "published";
}

/**
 * The tree the athlete is allowed to read, from raw rows.
 *
 * Draft weeks are removed together with their days and lines, so a draft cannot
 * reach the screen, the cache or a test fixture by way of a child row. Returns
 * null when nothing is published: a program with no live week is, to the
 * athlete, not there.
 */
export function visibleProgram(
  program: Program,
  rows: {
    blocks: readonly ProgramBlock[];
    weeks: readonly ProgramWeek[];
    days: readonly ProgramDay[];
    prescriptions: readonly Prescription[];
  },
): ProgramTree | null {
  if (program.status !== "published") return null;
  const weeks = rows.weeks.filter((w) => isVisibleWeek(program, w));
  if (weeks.length === 0) return null;
  const live = new Set(weeks.map((w) => w.id));
  const tree = assembleProgram(program, {
    blocks: rows.blocks,
    weeks,
    days: rows.days.filter((d) => live.has(d.weekId)),
    prescriptions: rows.prescriptions.filter((p) => live.has(p.weekId)),
  });
  // A block whose weeks were all drafts would show as an empty heading.
  return { ...tree, blocks: tree.blocks.filter((b) => b.weeks.length > 0) };
}

/* -------------------------------------------------------------------------
 * Day state
 * ---------------------------------------------------------------------- */

export type DayState =
  | { kind: "done"; sessionId: string }
  | { kind: "active" }
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "missed" }
  /** In the past, with no way to know: the sessions we hold do not reach back that far. */
  | { kind: "earlier" };

/**
 * Where each day stands against what the athlete has logged.
 *
 * "Done" is a finished session started from that day (`programDayId`); logged
 * work is the athlete's, so nothing the coach edits afterwards changes it.
 * "Missed" is a claim about the athlete, so it is only made when the loaded
 * sessions cover the date -- `SessionRecord`s come newest-first and capped, and
 * calling a day missed because its session fell off the list would be wrong in
 * exactly the way that makes someone distrust the screen.
 */
export function dayStates(
  tree: ProgramTree,
  sessions: readonly SessionRecord[],
  today: string,
  coversFrom: string | null,
): Map<string, DayState> {
  const done = new Map<string, SessionRecord>();
  const active = new Set<string>();
  for (const s of sessions) {
    if (!s.programDayId) continue;
    if (s.finishedAt) {
      const prev = done.get(s.programDayId);
      if (!prev || s.startedAt.getTime() > prev.startedAt.getTime()) done.set(s.programDayId, s);
    } else active.add(s.programDayId);
  }

  const states = new Map<string, DayState>();
  for (const day of allDays(tree)) {
    const logged = done.get(day.id);
    if (logged) states.set(day.id, { kind: "done", sessionId: logged.id });
    else if (active.has(day.id)) states.set(day.id, { kind: "active" });
    else if (day.scheduledOn === null || day.scheduledOn > today) states.set(day.id, { kind: "upcoming" });
    else if (day.scheduledOn === today) states.set(day.id, { kind: "today" });
    else if (coversFrom !== null && day.scheduledOn < coversFrom) states.set(day.id, { kind: "earlier" });
    else states.set(day.id, { kind: "missed" });
  }
  return states;
}

/**
 * The earliest day the loaded sessions can speak for, or null when they are
 * the whole history (fewer than the cap came back).
 */
export function sessionsCoverFrom(sessions: readonly SessionRecord[], cap: number, localDay: (d: Date) => string): string | null {
  if (sessions.length < cap) return null;
  const oldest = Math.min(...sessions.map((s) => s.startedAt.getTime()));
  return localDay(new Date(oldest));
}

export function allDays(tree: ProgramTree): ProgramDay[] {
  return tree.blocks.flatMap((b) => b.weeks.flatMap((w) => w.days));
}

export function allWeeks(tree: ProgramTree): WeekTree[] {
  return tree.blocks.flatMap((b) => b.weeks);
}

/**
 * The week to open: the one containing today, else the next one with a day
 * still to come, else the last (a finished block opens on its final week).
 */
export function currentWeekId(tree: ProgramTree, today: string): string | null {
  const weeks = allWeeks(tree);
  if (weeks.length === 0) return null;
  const dated = (w: WeekTree) => w.days.map((d) => d.scheduledOn).filter((d): d is string => d !== null).sort();
  const containing = weeks.find((w) => {
    const ds = dated(w);
    return ds.length > 0 && ds[0] <= today && today <= ds[ds.length - 1];
  });
  if (containing) return containing.id;
  const upcoming = weeks.find((w) => dated(w).some((d) => d >= today));
  if (upcoming) return upcoming.id;
  return weeks.some((w) => dated(w).length > 0) ? weeks[weeks.length - 1].id : weeks[0].id;
}

export interface BlockProgress {
  total: number;
  done: number;
  /** Every day is dated and in the past: nothing left to do or to start. */
  finished: boolean;
}

export function blockProgress(tree: ProgramTree, states: ReadonlyMap<string, DayState>, today: string): BlockProgress {
  const days = allDays(tree);
  const done = days.filter((d) => states.get(d.id)?.kind === "done").length;
  const finished = days.length > 0 && days.every((d) => d.scheduledOn !== null && d.scheduledOn < today);
  return { total: days.length, done, finished };
}
