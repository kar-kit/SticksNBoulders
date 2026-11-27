import { sickRangeProblem } from "@/appwrite/documents/sick";
import { addDays } from "@/lib/programming/program";

/**
 * Calling in sick, as pure logic (F31, docs/call-in-sick.md).
 *
 * A call-in is a run of the athlete's own calendar days, `YYYY-MM-DD`, both
 * ends included -- the convention `localDay` gives a session and `scheduledOn`
 * gives a program day, which is what makes every question here a string
 * comparison with no timezone in it. Two call-ins may overlap or touch; what
 * "sick" means is their union, so nothing here ever needs to merge rows.
 *
 * Nothing in this file writes anything, and nothing in it moves a session, a
 * program day or a prescription: calling in sick changes how a missed day
 * reads, not what is scheduled.
 */

/** The part of a call-in the derived states (missed, adherence) need. */
export interface SickSpan {
  startsOn: string;
  endsOn: string;
}

export interface SickSpell extends SickSpan {
  /** The row id, which is also its client id. */
  id: string;
  athleteId: string;
  note: string | null;
  createdAt: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * A call-in from a stored row, or null when the row is not one a screen may
 * act on: no id, no athlete, or a range that is not a range. The same rule
 * validate-row applies (`sickRangeProblem`), so a row it would delete is
 * never drawn in the meantime.
 */
export function toSpell(raw: Record<string, unknown>): SickSpell | null {
  const id = str(raw.$id);
  const athleteId = str(raw.athlete_id);
  if (!id || !athleteId || sickRangeProblem(raw.starts_on, raw.ends_on) !== null) return null;
  return {
    id,
    athleteId,
    startsOn: str(raw.starts_on),
    endsOn: str(raw.ends_on),
    note: str(raw.note) || null,
    createdAt: str(raw.created_at),
  };
}

export const coversDay = (span: SickSpan, day: string): boolean => span.startsOn <= day && day <= span.endsOn;

/** Whether `day` is inside any of the call-ins. */
export const isSickOn = (spans: readonly SickSpan[], day: string): boolean => spans.some((span) => coversDay(span, day));

/** Call-ins that have not finished before `today`: under way, or still to come. Earliest first. */
export function openSpells<T extends SickSpan>(spells: readonly T[], today: string): T[] {
  return spells.filter((s) => s.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

export interface SickNow {
  startsOn: string;
  /** The last sick day of the unbroken run that includes today. */
  endsOn: string;
  note: string | null;
}

/**
 * Whether the athlete is sick on `today`, and until when.
 *
 * Call-ins that overlap or run back to back are one stretch of illness: "I'm
 * sick today" and then, on the 28th, "and tomorrow" reads as sick until the
 * 29th, not as two rows that each end sooner. The note is the newest
 * call-in's that covers today and has one.
 */
export function sickNow(spells: readonly SickSpell[], today: string): SickNow | null {
  const covering = spells.filter((s) => coversDay(s, today));
  if (covering.length === 0) return null;
  let endsOn = covering.reduce((latest, s) => (s.endsOn > latest ? s.endsOn : latest), today);
  let extended = true;
  while (extended) {
    extended = false;
    for (const s of spells) {
      if (s.startsOn <= addDays(endsOn, 1) && s.endsOn > endsOn) {
        endsOn = s.endsOn;
        extended = true;
      }
    }
  }
  const startsOn = covering.reduce((earliest, s) => (s.startsOn < earliest ? s.startsOn : earliest), today);
  const note = [...covering].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((s) => s.note)?.note ?? null;
  return { startsOn, endsOn, note };
}

/** What ending one call-in does to its row: shorten it, or remove it. */
export interface EndAction {
  sickId: string;
  /** The new last sick day, or null to delete the call-in outright. */
  endsOn: string | null;
}

/**
 * "I'm better", or "never mind": what to do to each call-in so that `today`
 * and everything after it is no longer sick.
 *
 * One that began before today keeps the days already spent sick, ending
 * yesterday, so those days stay skipped rather than turning into missed
 * sessions. One that begins today or later has nothing left worth keeping and
 * is removed. A call-in that already ended is left alone. Idempotent: run
 * again on the result, it plans nothing.
 */
export function planEnd(spells: readonly SickSpell[], today: string): EndAction[] {
  return spells
    .filter((s) => s.endsOn >= today)
    .map((s) => ({ sickId: s.id, endsOn: s.startsOn >= today ? null : addDays(today, -1) }));
}

/** The call-ins as they stand once `actions` have landed. For the screen, before the queue has sent them. */
export function applyEnd(spells: readonly SickSpell[], actions: readonly EndAction[]): SickSpell[] {
  const byId = new Map(actions.map((a) => [a.sickId, a]));
  return spells.flatMap((s) => {
    const action = byId.get(s.id);
    if (!action) return [s];
    return action.endsOn === null ? [] : [{ ...s, endsOn: action.endsOn }];
  });
}
