/**
 * Where someone goes after signing in.
 *
 * Always the root, never a specific surface. The root is the one place that
 * knows whether a user has athletes linked to them, and therefore whether they
 * belong on a roster or on Today. Sending sign-in straight to /today meant a
 * coach landed in the athlete app and had to find their way out.
 */
export const AFTER_SIGN_IN = "/";

/** Where the root sends people once their role is known. */
export const ATHLETE_HOME = "/today";
export const COACH_HOME = "/coach/roster";
