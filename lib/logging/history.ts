import { weekStart } from "@/lib/strength/rollup";
import { sessionDateLabel, type SessionRecord } from "./session";

/**
 * The History list.
 *
 * Its real job, per the blueprint, is answering "what did I hit last time" and
 * finding the session with the set that was logged wrong. Both are scanning
 * tasks, which is why this is a list grouped by week rather than a calendar:
 * nobody navigates their training by looking at a month view, and a list is
 * faster to read and far cheaper to build.
 *
 * Pure. The numbers on a card come from the session row rather than being
 * re-derived here -- see historyCards.
 */

export interface HistoryCard {
  sessionId: string;
  startedAt: Date;
  finishedAt: Date | null;
  /** Null while a session is still running. */
  durationMs: number | null;
  /** In the order they were first worked, as the session itself showed them. */
  exerciseNames: string[];
  setCount: number;
  tonnageKg: number;
  /** Logged on this device and not yet at Appwrite. A quiet mark, never an error. */
  pendingSync: boolean;
}

export interface HistoryWeek {
  /** ISO of the Monday. Stable key, and what the heading is derived from. */
  weekStart: string;
  label: string;
  sessions: HistoryCard[];
}

/**
 * `4,200`. Thousands grouped, because tonnage is the one number in the product
 * that reaches five digits and "61000 kg" is genuinely harder to read than
 * "61,000 kg". Loads never get this -- a comma in a weight would be wrong.
 *
 * Grouped by hand rather than with toLocaleString, for the same reason the date
 * labels are: the separator must not change with the runtime's locale.
 */
export function formatTonnage(kg: number): string {
  const rounded = Math.round(kg);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * `1h 12m`, or `58m`. Never seconds: a session is not timed to the second and
 * showing that it was would imply a precision the number does not have.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "";
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}m` : `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * "This week", "Last week", or the date the week began.
 *
 * The same Monday-to-Sunday, Europe/London week the rollups use. Two different
 * ideas of a week in one product is how an athlete ends up looking at a chart
 * bar and a History heading that disagree about which session belongs where.
 */
export function weekLabel(week: Date, now: Date = new Date()): string {
  const current = weekStart(now).getTime();
  const difference = Math.round((current - week.getTime()) / (7 * 24 * 60 * 60 * 1000));
  if (difference === 0) return "This week";
  if (difference === 1) return "Last week";
  return `Week of ${sessionDateLabel(week)}`;
}

/** Newest first, the order someone scanning for "last time" is reading in. */
export function groupByWeek(cards: readonly HistoryCard[], now: Date = new Date()): HistoryWeek[] {
  const weeks = new Map<string, HistoryCard[]>();

  for (const card of [...cards].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())) {
    const key = weekStart(card.startedAt).toISOString();
    weeks.set(key, [...(weeks.get(key) ?? []), card]);
  }

  return [...weeks.entries()].map(([weekStartIso, sessions]) => ({
    weekStart: weekStartIso,
    label: weekLabel(new Date(weekStartIso), now),
    sessions,
  }));
}

/**
 * Filters by exercise name, because the real query is "show me my deadlift
 * sessions" -- the blueprint's words, and the reason this is not a date filter.
 *
 * Matches on a substring rather than the typeahead's ranking: there is nothing
 * to rank here, a session either contains the lift or it does not, and a
 * near-miss that silently hides a session is worse than a loose match.
 */
export function filterByExercise(weeks: readonly HistoryWeek[], query: string): HistoryWeek[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...weeks];

  return weeks
    .map((week) => ({
      ...week,
      sessions: week.sessions.filter((card) =>
        card.exerciseNames.some((name) => name.toLowerCase().includes(needle)),
      ),
    }))
    .filter((week) => week.sessions.length > 0);
}

/**
 * Builds the cards.
 *
 * The totals come from the session row, not from summing the sets. They were
 * written when the session was finished, and the finish screen showed the
 * athlete those exact numbers -- recomputing here would mean a session whose
 * finish is still queued shows one total on the summary and a different one on
 * History, with nothing to say which is right. The rebuild scripts are what
 * reconcile stored totals, not this screen.
 *
 * Exercise names come from the caller, which has the library in memory. Appwrite
 * has no joins, and fetching names here would tie the list to the library
 * finishing loading.
 */
export function historyCards(
  sessions: readonly SessionRecord[],
  exercisesOf: (sessionId: string) => string[],
  isPending: (sessionId: string) => boolean = () => false,
): HistoryCard[] {
  return sessions.map((session) => ({
    sessionId: session.id,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    durationMs: session.finishedAt
      ? session.finishedAt.getTime() - session.startedAt.getTime()
      : null,
    exerciseNames: exercisesOf(session.id),
    setCount: session.setCount,
    tonnageKg: session.tonnageKg,
    pendingSync: isPending(session.id),
  }));
}
