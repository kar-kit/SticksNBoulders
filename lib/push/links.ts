/**
 * Where a coach's notification opens (F27).
 *
 * Paths, not URLs: the service worker resolves them against its own origin,
 * so a payload can never send a tap somewhere else, and no deployment needs
 * to know its public hostname to build one.
 */

const enc = encodeURIComponent;

/**
 * One clip: the clip and its thread, open over the athlete's dashboard --
 * the existing `?clip=<setId>` panel (lib/coach/athlete-panel.ts).
 */
export function coachClipPath(athleteId: string, setId: string): string {
  return `/coach/athletes/${enc(athleteId)}?clip=${enc(setId)}`;
}

/** Several clips collapsed into one notification: the queue, oldest first. */
export const COACH_REVIEW_PATH = "/coach/review";

/**
 * A reply: F26's coach thread route (PR #132, coach-replies-inbox). It marks
 * the thread read, then redirects to `/coach/athletes/<id>?clip=<setId>`.
 *
 * The route lives on F26's branch, so this link 404s on any build without
 * it: F27 must merge after #132. If that route ever moves, this is the one
 * constant to change. `:setId` is filled in by `coachThreadPath`; the athlete
 * id is accepted for the day a route wants it, and unused today.
 */
export const COACH_THREAD_ROUTE = "/coach/replies/:setId";

export function coachThreadPath(_athleteId: string, setId: string): string {
  return COACH_THREAD_ROUTE.replace(":setId", enc(setId));
}

/** Where the "send a test" notification goes: back to the settings it came from. */
export const PUSH_SETTINGS_PATH = "/me";

/**
 * Whether a payload's path is one the worker will open. Same-origin and
 * absolute-path only: never a scheme, never `//host`.
 */
export function isAppPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
