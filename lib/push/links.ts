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
 * F26-SWAP. The one thing to change after rebasing onto F26
 * (coach-replies-inbox): point this at F26's coach thread route.
 *
 * Until F26 merges there is no thread route of its own, so a reply opens the
 * same clip-and-thread panel a clip does, which is where the thread is drawn
 * today. `:athleteId` and `:setId` are filled in by `coachThreadPath`.
 */
export const COACH_THREAD_ROUTE = "/coach/athletes/:athleteId?clip=:setId";

export function coachThreadPath(athleteId: string, setId: string): string {
  return COACH_THREAD_ROUTE.replace(":athleteId", enc(athleteId)).replace(":setId", enc(setId));
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
