/**
 * THIS BLOCK on the Athlete View, decided as pure logic.
 *
 * Joey's review of the dashboard (16 Oct 2026) asked for the current program
 * to be the prominent thing on the page: this block's current week at a
 * glance, its days and their exercises with loads where they resolve, and
 * whether it is published or still a draft. Before this the section was an
 * "Adjust program" button and a sentence promising the rest later.
 *
 * Read-only and built from what already exists: the program tree the editor
 * reads, `currentWeekId` from My Program, and the same line summaries the
 * athlete's own My Program and Today print -- so a line reads identically on
 * the coach's screen and the athlete's phone. Nothing here prices a load its
 * own way.
 *
 * Pure. No client, no network, no clock of its own.
 */

import { programAnchor, rangeLabel, weekIndexOf, weekRange } from "@/lib/programming/calendar";
import { allWeeks, currentWeekId, livePrograms } from "@/lib/programming/my-program";
import type { DayTree, Program, ProgramTree, WeekStatus } from "@/lib/programming/program";
import { basisMaxesFor, lineSummaries, planDay, referenceLookup, targetsFor } from "@/lib/programming/session-plan";
import type { AthleteMaxes } from "@/lib/programming/use-prescribed";
import { UNKNOWN_LIFT } from "./athlete-view";

export interface ShownProgram {
  program: Program;
  /** Published: what the athlete is training from. False for a draft the athlete cannot see. */
  live: boolean;
}

/**
 * Which of their programs the panel shows.
 *
 * The live one first -- the most recently updated published program, the
 * rule Today, My Program, the Roster's Block column and "Adjust program" all
 * share, so the panel and the editor it links to cannot disagree about which
 * block is current. Failing that, the draft touched last: a coach writing a
 * first block wants to see it here before publishing, and saying "no program"
 * over a block he wrote this morning would be false. Archived never.
 *
 * Re-filtered on the athlete, like resolveAdjustTarget: a program row that
 * came back for somebody else must not be drawn under this athlete's name.
 */
export function programToShow(programs: readonly Program[], athleteId: string): ShownProgram | null {
  const theirs = programs.filter((p) => p.athleteId === athleteId);
  const live = livePrograms(theirs, athleteId)[0];
  if (live) return { program: live, live: true };
  const draft = theirs
    .filter((p) => p.status === "draft")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return draft ? { program: draft, live: false } : null;
}

export interface GlanceExercise {
  exerciseId: string;
  name: string;
  /** "3 × 5 · 142.5 kg (77.5%)", one per line the coach wrote. */
  lines: string[];
}

export interface GlanceDay {
  id: string;
  label: string;
  /** YYYY-MM-DD, or null for a day not yet dated. */
  scheduledOn: string | null;
  /**
   * They started a session from this day (`sessions.program_day_id`). Null
   * when that could not be read -- unknown is not "not logged".
   */
  logged: boolean | null;
  isToday: boolean;
  notes: string | null;
  exercises: GlanceExercise[];
}

export interface WeekGlance {
  weekId: string;
  /** 1-based, counted across blocks. */
  number: number;
  of: number;
  /** The coach's own label when it says more than "Week N". */
  label: string | null;
  blockName: string;
  status: WeekStatus;
  /** "12–18 Oct", when the program has a calendar to count from. */
  range: string | null;
  /** Both the program and the week are published: the athlete sees this week. */
  visibleToAthlete: boolean;
  days: GlanceDay[];
}

export interface GlanceInputs {
  tree: ProgramTree;
  /** The coach's calendar day. */
  today: string;
  maxes: AthleteMaxes;
  nameOf: (exerciseId: string) => string | undefined;
  /** Days they started a session from, or null when that could not be read. */
  logged: ReadonlySet<string> | null;
  /** The date the maxes are read as of. */
  asOf: Date;
}

/**
 * The current week of a program, at a glance.
 *
 * The week is My Program's: the one containing today, else the next one with
 * a day still to come, else the last. Draft weeks are candidates here, unlike
 * on the athlete's phone, because the coach wrote them and is the one reading
 * -- `visibleToAthlete` says whether the athlete can see what is on screen.
 *
 * Loads are priced exactly as the athlete's My Program prices them: against
 * the athlete's current maxes, before anything is logged. A percentage with no
 * max says so in the line rather than inventing a weight, which is Order 18's
 * honest failure.
 */
export function weekGlance(input: GlanceInputs): WeekGlance | null {
  const { tree, today, maxes, nameOf, logged, asOf } = input;
  const weekId = currentWeekId(tree, today);
  if (!weekId) return null;
  const weeks = allWeeks(tree);
  const index = weekIndexOf(tree, weekId);
  const week = weeks[index];
  const block = tree.blocks.find((b) => b.weeks.some((w) => w.id === weekId));
  if (!week || !block) return null;

  const anchor = programAnchor(tree);
  const references = referenceLookup(maxes.entries, maxes.estimated, asOf, (id) => nameOf(id));
  const number = index + 1;
  const label = week.label && week.label.trim() !== `Week ${number}` ? week.label : null;

  return {
    weekId,
    number,
    of: weeks.length,
    label,
    blockName: block.name,
    status: week.status,
    range: anchor ? rangeLabel(weekRange(anchor, index)) : null,
    visibleToAthlete: tree.status === "published" && week.status === "published",
    days: week.days.map((day) => glanceDay(day, { today, maxes, nameOf, logged, asOf, references })),
  };
}

function glanceDay(
  day: DayTree,
  ctx: Omit<GlanceInputs, "tree"> & { references: ReturnType<typeof referenceLookup> },
): GlanceDay {
  const { maxes, asOf, references, nameOf } = ctx;
  return {
    id: day.id,
    label: day.label ?? "Session",
    scheduledOn: day.scheduledOn,
    logged: ctx.logged ? ctx.logged.has(day.id) : null,
    isToday: day.scheduledOn === ctx.today,
    notes: day.notes,
    exercises: planDay(day.prescriptions).map((planned) => ({
      exerciseId: planned.exerciseId,
      name: nameOf(planned.exerciseId) ?? UNKNOWN_LIFT,
      // Kilos: the coach side has no units provider, and the coach writes
      // and reads programs in kilos.
      lines: lineSummaries(
        planned,
        targetsFor(planned, basisMaxesFor(planned.exerciseId, maxes.entries, maxes.estimated, asOf), [], references, "kg"),
      ),
    })),
  };
}

/** "Fri 16 Oct" for a calendar day, read as that day wherever the coach is. */
export function glanceDate(day: string | null): string {
  if (!day) return "Not dated";
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
