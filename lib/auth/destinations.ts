/**
 * Where someone goes after signing in.
 *
 * Always the root, never a specific surface. The root is the one place that
 * knows which side someone last used -- and, for an account that has never
 * said, whether athletes are linked to it -- and therefore whether they belong
 * on a roster, on Today, or on the first-run question. Sending sign-in straight
 * to /today meant a coach landed in the athlete app and had to find their way
 * out. See lib/auth/mode.ts for the table.
 */
export const AFTER_SIGN_IN = "/";

/** Where the root sends people once their mode is known. */
export const ATHLETE_HOME = "/today";
export const COACH_HOME = "/coach/roster";

/** The first-run question: coach or athlete. Shown once, to an account with no mode. */
export const WELCOME = "/welcome";
