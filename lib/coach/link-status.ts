/**
 * The coach's side of a link ending, decided as pure logic.
 *
 * Order 16.6. Unlinking is athlete-initiated and instant (Order 16.5): the
 * coach leaves the circle team and every read through it stops at once. This
 * module decides what the coach's screens say about that, so that "no longer
 * linked" is a state they render rather than an error they stumble into.
 *
 * The coach can read their own link rows, revoked ones included -- the row is
 * stamped readable by both parties (policy.ts, linkPermissions) and revoking
 * re-stamps it unchanged. That is the whole data source. Nothing here needs,
 * or is allowed, a read the circle no longer grants: the athlete's name, sets
 * and comments all went with the membership, and this module never asks for
 * them back.
 */

export interface CoachLinkRecord {
  athleteId: string;
  status: "active" | "revoked";
  /** ISO 8601. Null only for a malformed row. */
  revokedAt: string | null;
}

export type AthleteLinkState =
  /** Linked now. Everything renders. */
  | { kind: "linked" }
  /** Linked once, withdrawn by the athlete. */
  | { kind: "left"; revokedAt: Date | null }
  /**
   * No link on record -- a mistyped URL, or an athlete of somebody else's.
   * Indistinguishable on purpose: telling a coach "this person exists but is
   * not yours" would be a disclosure about a stranger.
   */
  | { kind: "never" }
  /**
   * The row says linked but the circle membership is not there (yet). Linking
   * writes the row first and the membership second, so a re-link seen live
   * passes through this for a moment -- and a half-failed redemption stays in
   * it until the athlete redeems again. Rendering the panels here would show
   * "No maxes yet" about somebody who has maxes.
   */
  | { kind: "not-visible" };

const toDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Where one athlete stands with this coach, from the coach's own rows. */
export function athleteLinkState(
  athleteId: string,
  records: readonly CoachLinkRecord[],
): AthleteLinkState {
  const mine = records.filter((record) => record.athleteId === athleteId);
  // Active wins over anything else on record. The unique index means there is
  // one row per pair, but a stale page read beside a fresh one must never turn
  // a linked athlete into a departed one.
  if (mine.some((record) => record.status === "active")) return { kind: "linked" };
  const revoked = mine.find((record) => record.status === "revoked");
  if (revoked) return { kind: "left", revokedAt: toDate(revoked.revokedAt) };
  return { kind: "never" };
}

/**
 * Folds in whether the coach can actually see the athlete's circle. The row is
 * the record, the membership is the access; only both together are "linked".
 */
export function withAccess(state: AthleteLinkState, circleVisible: boolean): AthleteLinkState {
  return state.kind === "linked" && !circleVisible ? { kind: "not-visible" } : state;
}

export interface Departure {
  athleteId: string;
  revokedAt: Date;
}

/**
 * How long a departure stays on the Roster. A fortnight covers a coach who
 * checks in once a week and misses one [Inference -- Ruairi's review cadence is
 * the open Roster question, blueprint 10].
 */
export const DEPARTURE_WINDOW_DAYS = 14;

/**
 * Athletes who left recently, newest first.
 *
 * Re-linking reactivates the same row, so an athlete who left and came back is
 * simply active again and drops out of this list with no bookkeeping. A
 * departure dated in the future (clock skew between the instance and the
 * browser) is kept: hiding it would make the notice flicker in for the one
 * coach whose laptop clock is slow.
 */
export function recentDepartures(
  records: readonly CoachLinkRecord[],
  now: Date,
  windowDays: number = DEPARTURE_WINDOW_DAYS,
): Departure[] {
  const active = new Set(records.filter((r) => r.status === "active").map((r) => r.athleteId));
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const seen = new Set<string>();
  const departures: Departure[] = [];

  for (const record of records) {
    if (record.status !== "revoked" || active.has(record.athleteId) || seen.has(record.athleteId)) continue;
    const revokedAt = toDate(record.revokedAt);
    // A revoked row with no date cannot be placed in a window. Dropped rather
    // than shown as "left recently" forever.
    if (!revokedAt || revokedAt.getTime() < cutoff) continue;
    seen.add(record.athleteId);
    departures.push({ athleteId: record.athleteId, revokedAt });
  }

  return departures.sort((a, b) => b.revokedAt.getTime() - a.revokedAt.getTime());
}

/** "26 Sep", in UTC like `linkedDateLabel`, so both sides print the same day. */
export function shortDate(at: Date): string {
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/**
 * The Roster's quiet line. Null when nobody left, so the caller renders nothing.
 *
 * Unnamed, deliberately. The coach can no longer read the athlete's profile --
 * the name went with the circle -- and fetching it back through the server key
 * would be a new disclosure about somebody who has just withdrawn consent.
 * Whether Ruairi wants names here is his call [SME to confirm, Build Plan 16.6];
 * with a handful of athletes the rail already shows who is missing.
 */
export function departureNotice(departures: readonly Departure[]): string | null {
  if (departures.length === 0) return null;
  if (departures.length === 1) {
    return `An athlete stopped sharing their training with you on ${shortDate(departures[0].revokedAt)}.`;
  }
  return `${departures.length} athletes stopped sharing their training with you in the last ${DEPARTURE_WINDOW_DAYS} days, most recently on ${shortDate(departures[0].revokedAt)}.`;
}

/**
 * What the Athlete View says at an ex-athlete's URL.
 *
 * One sentence on what happened, one on what comes back. The coach's own
 * comments are named explicitly because they are the thing a coach will look
 * for and assume was deleted: they were not, they are just unreadable while the
 * link is withdrawn.
 */
export function notLinkedCopy(state: Exclude<AthleteLinkState, { kind: "linked" }>): {
  title: string;
  body: string;
} {
  if (state.kind === "left") {
    const when = state.revokedAt ? ` on ${shortDate(state.revokedAt)}` : "";
    return {
      title: "No longer linked",
      body:
        `This athlete stopped sharing their training with you${when}. ` +
        "Their sessions, videos and your comments on them are kept, not deleted, " +
        "and come back if they link with your code again.",
    };
  }
  if (state.kind === "not-visible") {
    return {
      title: "Linked, nothing showing yet",
      body:
        "This athlete's link is recorded but their training isn't reaching you yet. " +
        "It usually settles within a few seconds; if it doesn't, ask them to enter your code again.",
    };
  }
  return {
    title: "Not one of your athletes",
    body: "Nobody at this address is sharing their training with you. Athletes appear here once they redeem your invite code.",
  };
}

/**
 * Which clips have left the queue because their athlete unlinked.
 *
 * The Review Queue re-reads the coach's links on every refresh and carries
 * this forward, so it can say why clips vanished rather than letting a coach
 * wonder whether they cleared them. Keyed by clip id, so two refreshes racing
 * each other count a clip once; and an athlete who links again takes their
 * clips back out of it, because those clips are back on screen.
 */
export function reconcileDropped(
  alreadyDropped: ReadonlyMap<string, string>,
  onScreen: readonly { id: string; athleteId: string }[],
  activeAthleteIds: ReadonlySet<string>,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const [clipId, athleteId] of alreadyDropped) {
    if (!activeAthleteIds.has(athleteId)) next.set(clipId, athleteId);
  }
  for (const item of onScreen) {
    if (!activeAthleteIds.has(item.athleteId)) next.set(item.id, item.athleteId);
  }
  return next;
}

/** The queue's line for clips that left with their athlete. */
export function droppedClipsNotice(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "A clip left the queue because the athlete who filmed it is no longer linked with you."
    : `${count} clips left the queue because the athletes who filmed them are no longer linked with you.`;
}

/** True when two id lists name the same athletes, in any order. */
export function sameAthletes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
