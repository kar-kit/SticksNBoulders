import { readLocal, removeLocal, writeLocal } from "@/lib/local-store";
import type { PriorBests, RepBest } from "@/lib/strength/pr";
import type { ExerciseHistory } from "./exercise-history-store";
import type { PreviousSet } from "./previous";

/**
 * Last time and the bests to beat, remembered for the running session.
 *
 * The case it is for: the reads landed at the gym door, then the phone
 * reloaded in a basement. Without this the Previous lines and the PR badges
 * vanish for the rest of the session, and a set logged from then on is never
 * celebrated.
 *
 * Scoped to one session, not a read cache for history. Both answers are
 * frozen at the session's start (lib/strength/pr.ts), so what was read for
 * this session is still the right answer an hour later and never stale. A
 * new session starts empty and reads afresh; a cold start with no signal on
 * a session never read online shows nothing, as before. Re-fetchable in two
 * requests, so localStorage, like the library.
 */

const KEY = "snb.exercise-history";

interface Stored {
  athleteId: string;
  sessionId: string;
  exercises: Record<string, ExerciseHistory>;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nullableFinite = (value: unknown): value is number | null => value === null || finite(value);

function parsePrevious(value: unknown): PreviousSet[] | null {
  if (!Array.isArray(value)) return null;
  const sets = value.filter(
    (s): s is PreviousSet =>
      typeof s === "object" &&
      s !== null &&
      finite(s.loadKg) &&
      finite(s.reps) &&
      typeof s.isWarmup === "boolean" &&
      // F19. Optional, so an entry remembered before v19 still parses.
      (s.failed === undefined || typeof s.failed === "boolean") &&
      // F23. Optional too: an entry from before v21 is a strength set.
      (s.durationSeconds === undefined || nullableFinite(s.durationSeconds)) &&
      (s.level === undefined || nullableFinite(s.level)),
  );
  return sets.length === value.length ? sets : null;
}

/** Undefined when it does not parse; null when it was never known. */
function parseRepsAt(value: unknown): RepBest[] | null | undefined {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return undefined;
  const points = value.filter(
    (p): p is RepBest => typeof p === "object" && p !== null && finite(p.loadKg) && Number.isInteger(p.reps),
  );
  return points.length === value.length ? points : undefined;
}

function parseBests(value: unknown): PriorBests | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { e1rmKg, heaviestKg, repsAt } = value as Record<string, unknown>;
  const reps = parseRepsAt(repsAt);
  return nullableFinite(e1rmKg) && nullableFinite(heaviestKg) && reps !== undefined
    ? { e1rmKg, heaviestKg, repsAt: reps }
    : undefined;
}

/** This session's remembered history of one exercise, if it parses. */
export function recallExerciseHistory(
  athleteId: string,
  sessionId: string,
  exerciseId: string,
): ExerciseHistory | null {
  const stored = readLocal<Partial<Stored>>(KEY);
  if (stored?.athleteId !== athleteId || stored.sessionId !== sessionId) return null;
  const entry = stored.exercises?.[exerciseId] as Partial<ExerciseHistory> | undefined;
  if (!entry || typeof entry !== "object") return null;
  const previous = parsePrevious(entry.previous);
  const bests = parseBests(entry.bests);
  return previous && bests !== undefined ? { previous, bests } : null;
}

/** Adds one exercise. A different athlete or session replaces what was kept. */
export function rememberExerciseHistory(
  athleteId: string,
  sessionId: string,
  exerciseId: string,
  history: ExerciseHistory,
): void {
  const stored = readLocal<Partial<Stored>>(KEY);
  const same = stored?.athleteId === athleteId && stored.sessionId === sessionId && typeof stored.exercises === "object";
  writeLocal(KEY, {
    athleteId,
    sessionId,
    exercises: { ...(same ? stored.exercises : {}), [exerciseId]: history },
  } satisfies Stored);
}

export function forgetRememberedExerciseHistory(): void {
  removeLocal(KEY);
}
