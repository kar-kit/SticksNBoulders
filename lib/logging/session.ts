/**
 * Rules about a training session, kept out of the components that draw it.
 *
 * A session is "live" while `finished_at` is null -- the schema says so, and it
 * is what Resume reads. Everything here is pure, so the awkward cases (two
 * unfinished sessions, a clock that ran while the phone was asleep) are tests
 * rather than opinions.
 */

export interface SessionRecord {
  id: string;
  clientSessionId: string;
  startedAt: Date;
  finishedAt: Date | null;
  setCount: number;
  tonnageKg: number;
  notes?: string | null;
}

export interface SessionSet {
  exerciseId: string;
  exerciseName: string;
  loadKg: number;
  reps: number;
  isWarmup: boolean;
  loggedAt: Date;
}

export const isLive = (session: SessionRecord): boolean => session.finishedAt === null;

/**
 * The session Resume should reopen.
 *
 * There can be more than one unfinished session: a crashed tab, a second
 * device, a finish write that failed after the sets landed. The offline queue
 * at Order 9 makes that more likely, not less. The most recently started one is
 * the one the athlete is standing in; the others are left alone rather than
 * closed, because silently finishing somebody's session is worse than leaving a
 * stray row for the History screen to show.
 */
export function pickActiveSession(sessions: readonly SessionRecord[]): SessionRecord | null {
  const live = sessions.filter(isLive);
  if (live.length === 0) return null;
  return live.reduce((latest, candidate) =>
    candidate.startedAt.getTime() > latest.startedAt.getTime() ? candidate : latest,
  );
}

/** The most recent finished session, for Today's "last session" line. */
export function lastFinishedSession(sessions: readonly SessionRecord[]): SessionRecord | null {
  const done = sessions.filter((s) => s.finishedAt !== null);
  if (done.length === 0) return null;
  return done.reduce((latest, candidate) =>
    candidate.startedAt.getTime() > latest.startedAt.getTime() ? candidate : latest,
  );
}

/**
 * Elapsed time, always derived from when the session started.
 *
 * Never from a counter ticking in an interval. A backgrounded phone stops the
 * interval and the world keeps going, so an athlete who takes a call comes back
 * to a clock that under-reports the session by the length of the call -- and
 * "never lose a session to a backgrounded app or a phone call" is in the
 * blueprint for exactly this reason.
 */
export function elapsedMs(startedAt: Date, now: Date = new Date()): number {
  return Math.max(0, now.getTime() - startedAt.getTime());
}

/** "0:47:12", the blueprint's format. Hours are never padded; seconds always. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

export interface ExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  sets: SessionSet[];
}

/**
 * The sets of a session, grouped into the exercises the screen shows.
 *
 * Order is first-set-logged, because there is no session_exercises table and
 * deliberately so: an exercise is in a session because work was logged against
 * it. An exercise added but not yet logged into exists only in the screen's own
 * state until its first set lands -- see the Log Session page.
 */
export function groupByExercise(sets: readonly SessionSet[]): ExerciseGroup[] {
  const groups = new Map<string, ExerciseGroup>();
  const ordered = [...sets].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());

  for (const set of ordered) {
    const group = groups.get(set.exerciseId);
    if (group) group.sets.push(set);
    else groups.set(set.exerciseId, { exerciseId: set.exerciseId, exerciseName: set.exerciseName, sets: [set] });
  }
  return [...groups.values()];
}

export interface SessionSummary {
  setCount: number;
  tonnageKg: number;
  exerciseCount: number;
  warmupCount: number;
}

/**
 * What gets written on finish, and what the summary screen shows.
 *
 * [Inference] Warm-ups are excluded from both the set count and the tonnage.
 * Order 8 states the rule for PRs and rollups -- "warm up sets excluded" -- and
 * a session total that disagreed with the weekly rollup would have an athlete
 * comparing two numbers that should match and finding they do not. They are
 * counted separately so the screen can still say how many there were.
 * [SME to confirm] with Ruairi, who may well count everything that moved.
 */
export function summariseSession(sets: readonly SessionSet[]): SessionSummary {
  const working = sets.filter((set) => !set.isWarmup);
  return {
    setCount: working.length,
    tonnageKg: Math.round(working.reduce((total, set) => total + set.loadKg * set.reps, 0) * 10) / 10,
    exerciseCount: new Set(sets.map((set) => set.exerciseId)).size,
    warmupCount: sets.length - working.length,
  };
}

/**
 * Day and month names, spelled out rather than left to Intl.
 *
 * `toLocaleDateString("en-GB", { month: "short" })` renders September as
 * "Sept" on current ICU and "Sep" on older ones. The blueprint writes "Sep",
 * and a header that changes width with the Node version is not worth the
 * convenience.
 */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sunday 13 Sep", the blueprint's header. */
export function sessionDateLabel(date: Date): string {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "Thu, Deadlift" for Today's last-session line; the name is the first exercise. */
export function lastSessionLabel(session: SessionRecord, firstExercise: string | null): string {
  const day = DAYS[session.startedAt.getDay()].slice(0, 3);
  return firstExercise ? `${day}, ${firstExercise}` : day;
}
