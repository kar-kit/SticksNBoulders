import { dayDate } from "@/lib/bodyweight/bodyweight";
import { shortDate } from "@/lib/coach/athlete-view";
import { sessionDateLabel } from "@/lib/logging/session";

/**
 * How a call-in's days read on a screen (F31). Kept apart from sick.ts so the
 * derived-state code (My Program, the Roster's signals) can import the logic
 * without importing the screens' formatters. Both labels reuse the app's own
 * date formats rather than adding a third.
 */

/** "Fri 28 Nov", or "Fri 28 Nov to Sun 30 Nov". The athlete's side, with the weekday. */
export function sickRangeLabel(startsOn: string, endsOn: string): string {
  const start = dayDate(startsOn);
  const end = dayDate(endsOn);
  if (!start || !end) return "";
  return startsOn === endsOn
    ? sessionDateLabel(start)
    : `${sessionDateLabel(start)} to ${sessionDateLabel(end)}`;
}

/** "28 Nov", or "28 Nov to 30 Nov". The coach's side, in the format the Roster already uses for dates. */
export function sickShortRange(startsOn: string, endsOn: string, now: Date = new Date()): string {
  const start = dayDate(startsOn);
  const end = dayDate(endsOn);
  if (!start || !end) return "";
  return startsOn === endsOn ? shortDate(start, now) : `${shortDate(start, now)} to ${shortDate(end, now)}`;
}
