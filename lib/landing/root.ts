import { landingFor, type Mode } from "@/lib/auth/mode";
import { REMEMBERED_USER_KEY } from "@/lib/auth/remembered-user";
import type { SessionState } from "@/lib/auth/session-context";

/**
 * What the root does for each session state.
 *
 * Signed in: exactly what it did before the public page existed, the
 * `landingFor` table in lib/auth/mode.ts. Signed out: stay, because the root
 * is now the front door rather than a redirect to /sign-in. Still loading:
 * nothing yet.
 */
export type RootDecision =
  | { kind: "wait" }
  | { kind: "public" }
  | { kind: "go"; to: string; adopt: Mode | null };

export function rootDecision(state: SessionState): RootDecision {
  if (state.status === "loading") return { kind: "wait" };
  if (state.status === "signed-out") return { kind: "public" };
  const landing = landingFor({
    signedIn: true,
    mode: state.prefs.mode,
    hasLinks: state.coach.isCoach,
    offline: state.offline,
  });
  return { kind: "go", to: landing.to, adopt: landing.adopt };
}

/**
 * Set on <html> while the visitor is probably signed in. globals.css hides the
 * public page under it, so a returning athlete opening the installed app sees
 * the same blank dark frame they always did, not a flash of marketing on the
 * way to Today.
 */
export const RETURNING_ATTRIBUTE = "data-returning";

/**
 * Runs as the HTML parses, before first paint. "Probably signed in" is the
 * remembered-user record: it is written on every successful session and
 * removed on sign-out and on a session Appwrite refuses. It is a hint about
 * what to paint, never about access. If it is stale, the gate removes the
 * attribute the moment the session comes back signed out.
 */
export const RETURNING_SCRIPT =
  `try{if(localStorage.getItem(${JSON.stringify(REMEMBERED_USER_KEY)}))` +
  `document.documentElement.setAttribute(${JSON.stringify(RETURNING_ATTRIBUTE)},"")}catch(e){}`;
