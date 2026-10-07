import { ticketSecret } from "./ticket";

export type StartupCheck =
  | { status: "ok" }
  | { status: "warn" | "fail"; message: string };

interface StartupCheckInput {
  env: Record<string, string | undefined>;
  /** `process.env.NODE_ENV`. Only "production" is strict. */
  nodeEnv: string | undefined;
  /** `process.env.NEXT_PHASE`. Set to "phase-production-build" during `next build`. */
  phase: string | undefined;
}

/** Next's own constant, not exported from a path that is safe to import here. */
const BUILD_PHASE = "phase-production-build";

/**
 * Whether the clip signing key is usable, and what to do about it if not.
 *
 * Without it the app builds and boots and every coach playback request then
 * fails with one log line and a review screen that says the clip "could not be
 * loaded" -- the cause is invisible from where anyone is looking. So a
 * production start refuses; development warns once so `next dev` still runs.
 *
 * The build is exempt. CI has no secret and should not need one: it is a
 * runtime credential, and `next build` never serves a request.
 *
 * The length rule is `ticketSecret`'s. This asks it and reports its answer, so
 * there is one rule to change.
 */
export function checkVideoTicketSecret({ env, nodeEnv, phase }: StartupCheckInput): StartupCheck {
  if (phase === BUILD_PHASE) return { status: "ok" };

  try {
    ticketSecret(env);
    return { status: "ok" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "VIDEO_TICKET_SECRET is not usable.";
    const fix = "Generate one with `openssl rand -base64 48` and set it in the server's environment.";
    return nodeEnv === "production"
      ? { status: "fail", message: `${reason} Refusing to start. ${fix}` }
      : { status: "warn", message: `${reason} Clips will not play until it is set. ${fix}` };
  }
}
