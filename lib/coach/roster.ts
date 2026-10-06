/**
 * The Roster table, decided as pure logic.
 *
 * Order 24, blueprint 10. One row per linked athlete: this week, videos,
 * bodyweight, block. Next comp is in the blueprint and deliberately absent --
 * there is no meet data in the MVP (comp planning is February 2027).
 *
 * Nothing here aggregates raw sets. The week's working sets come from
 * `stats_rollups`; sessions completed are session rows, one per session, which
 * is a count of rows rather than a GROUP BY over sets. See docs/rollups.md and
 * docs/roster.md.
 */

import { latestEntry, trend, dayKey, type BodyweightEntry } from "@/lib/bodyweight/bodyweight";
import type { ClipSet } from "@/lib/review/queue";
import { weekStart } from "@/lib/strength/rollup";
import type { AthleteSignals, ProgramSignals } from "./roster-triggers";

/** Same words as the Review Queue for an athlete with no profile row yet. */
export const UNNAMED_ATHLETE = "Unnamed athlete";

export interface RosterLink {
  athleteId: string;
  linkedAt: Date | null;
}

export interface WeekSession {
  athleteId: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface WeekRollup {
  athleteId: string;
  weekStart: string;
  setCount: number;
}

export interface RosterInputs {
  links: readonly RosterLink[];
  names: ReadonlyMap<string, string>;
  /** Circle visible per athlete. Missing means not visible. */
  visible: ReadonlyMap<string, boolean>;
  sessions: readonly WeekSession[];
  rollups: readonly WeekRollup[];
  clips: readonly ClipSet[];
  reviewedSetIds: ReadonlySet<string>;
  bodyweight: readonly BodyweightEntry[];
  /** Order 19 seam: empty until the program exists. */
  program: ReadonlyMap<string, ProgramSignals>;
}

export interface RosterBodyweight {
  latestKg: number;
  measuredOn: string;
  /** Window-on-window change; null when there is no previous week to compare. */
  changeKg: number | null;
  /** The last weigh-in is older than the averaging window, so there is no trend. */
  stale: boolean;
}

export interface RosterRow {
  athleteId: string;
  name: string;
  visible: boolean;
  sessionsThisWeek: number;
  setsThisWeek: number;
  videosWaiting: number;
  bodyweight: RosterBodyweight | null;
  /** Order 19 seam. */
  block: string | null;
}

const sameWeek = (iso: string, week: Date): boolean => {
  const at = new Date(iso);
  return !Number.isNaN(at.getTime()) && weekStart(at).getTime() === week.getTime();
};

/** The rows and the trigger inputs, from the same reads, so they cannot disagree. */
export function buildRoster(input: RosterInputs, now: Date): { rows: RosterRow[]; signals: AthleteSignals[] } {
  const week = weekStart(now);
  const today = dayKey(now);
  const rows: RosterRow[] = [];
  const signals: AthleteSignals[] = [];

  for (const link of input.links) {
    const id = link.athleteId;
    const visible = input.visible.get(id) ?? false;
    const name = input.names.get(id) ?? UNNAMED_ATHLETE;

    // Completed means finished. A session left open is still in progress, or
    // abandoned; neither is a session done.
    const sessionsThisWeek = input.sessions.filter(
      (s) => s.athleteId === id && s.finishedAt !== null && sameWeek(s.startedAt, week),
    ).length;
    const setsThisWeek = input.rollups
      .filter((r) => r.athleteId === id && sameWeek(r.weekStart, week))
      .reduce((sum, r) => sum + r.setCount, 0);
    const videosWaiting = input.clips.filter((c) => c.athleteId === id && !input.reviewedSetIds.has(c.id)).length;

    const entries = input.bodyweight.filter((e) => e.athleteId === id);
    const newest = latestEntry(entries);
    const moving = trend(entries, undefined, today);
    const bodyweight: RosterBodyweight | null = newest
      ? {
          latestKg: newest.weightKg,
          measuredOn: newest.measuredOn,
          changeKg: moving?.changeKg ?? null,
          stale: moving === null,
        }
      : null;

    const program = input.program.get(id) ?? null;

    rows.push({
      athleteId: id,
      name,
      visible,
      sessionsThisWeek,
      setsThisWeek,
      videosWaiting,
      bodyweight,
      block: program?.blockLabel ?? null,
    });
    signals.push({
      athleteId: id,
      name,
      visible,
      linkedAt: link.linkedAt,
      unreviewedClips: videosWaiting,
      lastBodyweightOn: newest?.measuredOn ?? null,
      program,
    });
  }

  return { rows, signals };
}

// --- sorting -----------------------------------------------------------------

export type SortKey = "name" | "week" | "videos" | "bodyweight" | "block";
export type SortDir = "asc" | "desc";
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

/** Alphabetical, the way a coach finds a person in a list. [Inference] */
export const DEFAULT_SORT: Sort = { key: "name", dir: "asc" };

/**
 * The direction a column sorts in on its first click. Numbers start with the
 * biggest, because the athlete with the most waiting is the one being looked
 * for; text starts at A.
 */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  week: "desc",
  videos: "desc",
  bodyweight: "desc",
  block: "asc",
};

/** Clicking the active column flips it; clicking another starts it fresh. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: FIRST_DIR[key] };
}

type Value = number | string | null;

const valueOf = (row: RosterRow, key: SortKey): Value => {
  switch (key) {
    case "name":
      return row.name;
    case "week":
      // Sessions first, sets to break the tie: three sessions beats two big ones.
      return row.sessionsThisWeek * 10_000 + row.setsThisWeek;
    case "videos":
      return row.videosWaiting;
    case "bodyweight":
      return row.bodyweight?.latestKg ?? null;
    case "block":
      return row.block;
  }
};

/**
 * Sorted, with blanks always last whichever way the column runs -- an athlete
 * with no weigh-ins is not the lightest one -- and name breaking every tie so
 * the order is stable between refreshes.
 */
export function sortRows(rows: readonly RosterRow[], sort: Sort): RosterRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    let cmp = 0;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else if (va !== null && vb !== null) cmp = String(va).localeCompare(String(vb));
    return cmp * sign || a.name.localeCompare(b.name);
  });
}

// --- labels ------------------------------------------------------------------

export function weekLabel(row: RosterRow): string {
  const sessions = `${row.sessionsThisWeek} session${row.sessionsThisWeek === 1 ? "" : "s"}`;
  if (row.setsThisWeek === 0) return sessions;
  return `${sessions} · ${row.setsThisWeek} set${row.setsThisWeek === 1 ? "" : "s"}`;
}

/** "+0.4" / "−0.6" / "±0.0", with a real minus sign. */
export function changeLabel(changeKg: number): string {
  if (changeKg === 0) return "±0.0";
  return `${changeKg > 0 ? "+" : "−"}${Math.abs(changeKg).toFixed(1)}`;
}
