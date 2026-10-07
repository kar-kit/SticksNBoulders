/**
 * "Adjust program", decided as pure logic.
 *
 * Ruairi's review day, in his words: "Watch videos, analyse weaknesses and
 * then adjust program accordingly" (form answer, 6 Oct 2026). The first two
 * happen in the Review Queue and the Athlete View; this is the step between
 * them and the third -- from a clip, or from the person, to the block that
 * needs changing, without a detour through the Programs index.
 *
 * Where it lands, best first:
 *
 * 1. The day the clip's set was prescribed from. A set logged against a line
 *    carries `prescription_id`; the line carries its week and day. The line is
 *    only followed if it is this athlete's and its program is one of theirs
 *    that is not archived -- a pointer read from a URL is a claim, not a fact.
 * 2. Their current program: the published one updated last, the same rule
 *    Today, My Program and the Roster's Block column use.
 * 3. Their programs, listed, when they have some and none is live.
 * 4. A real empty state when nobody has written them anything.
 *
 * None of it is reached without an ACTIVE link between this coach and this
 * athlete. The link row is the source of truth, exactly as in Athlete View --
 * not the session's cached list, and not whether a program row happens to be
 * readable. A coach's read of a program they wrote survives a revoke (their
 * own work product, docs/programs.md), so "the row came back" proves nothing
 * about whether they still coach this person.
 */

import type { AthleteAccess } from "./athlete-view";
import { rowId, type Program } from "@/lib/programming/program";
import { livePrograms } from "@/lib/programming/my-program";

/** The parts of a prescription line needed to find it in the editor. */
export interface TracedLine {
  id: string;
  /** From the row itself, so a line from somebody else's program is caught. */
  athleteId: string | null;
  programId: string;
  weekId: string;
  dayId: string;
}

/** Where the editor should open. Every field optional: it falls back to its own default. */
export interface EditorLanding {
  weekId?: string;
  dayId?: string;
  lineId?: string;
}

export type AdjustTarget =
  /** No active link. Nothing of theirs is shown or navigated to. */
  | { kind: "refused"; access: Exclude<AthleteAccess, { kind: "linked" }> }
  | { kind: "editor"; programId: string; landing: EditorLanding; traced: boolean }
  /** They have programs, none of them live. */
  | { kind: "list"; programs: Program[] }
  /** Nothing written for them yet. */
  | { kind: "none" };

export function resolveAdjustTarget(input: {
  athleteId: string;
  access: AthleteAccess;
  programs: readonly Program[];
  line: TracedLine | null;
}): AdjustTarget {
  const { athleteId, access, line } = input;
  if (access.kind !== "linked") return { kind: "refused", access };

  // Re-filtered rather than trusting the query that fetched them, for the same
  // reason decideAthleteAccess re-filters its rows: fail closed.
  const theirs = input.programs.filter((p) => p.athleteId === athleteId);

  if (line && line.athleteId === athleteId) {
    const program = theirs.find((p) => p.id === line.programId && p.status !== "archived");
    if (program) {
      return {
        kind: "editor",
        programId: program.id,
        landing: { weekId: line.weekId, dayId: line.dayId, lineId: line.id },
        traced: true,
      };
    }
  }

  const current = livePrograms(theirs, athleteId)[0];
  if (current) return { kind: "editor", programId: current.id, landing: {}, traced: false };

  if (theirs.length > 0) return { kind: "list", programs: [...theirs] };
  return { kind: "none" };
}

/** A URL value that is a plausible row id, or null. Anything else is ignored, not trusted. */
export function idParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first !== undefined && rowId.safeParse(first).success ? first : null;
}

/** The "Adjust program" link, from a clip (with its line) or from Athlete View (without). */
export function adjustProgramHref(athleteId: string, prescriptionId?: string | null): string {
  const query = new URLSearchParams({ athlete: athleteId });
  if (prescriptionId) query.set("line", prescriptionId);
  return `/coach/programs?${query.toString()}`;
}

/** The editor, opened on a week and day when there is one to open on. */
export function editorHref(programId: string, landing: EditorLanding): string {
  const query = new URLSearchParams();
  if (landing.weekId) query.set("week", landing.weekId);
  if (landing.dayId) query.set("day", landing.dayId);
  if (landing.lineId) query.set("line", landing.lineId);
  const search = query.toString();
  return `/coach/programs/${encodeURIComponent(programId)}${search ? `?${search}` : ""}`;
}

/** The editor's landing, read back out of its URL. Malformed ids are dropped. */
export function landingFrom(query: Record<string, string | string[] | undefined>): EditorLanding {
  const landing: EditorLanding = {};
  const weekId = idParam(query.week);
  const dayId = idParam(query.day);
  const lineId = idParam(query.line);
  if (weekId) landing.weekId = weekId;
  if (dayId) landing.dayId = dayId;
  if (lineId) landing.lineId = lineId;
  return landing;
}
