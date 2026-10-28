"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/session-context";
import { RETURNING_ATTRIBUTE, rootDecision } from "@/lib/landing/root";

/**
 * The root decides where someone belongs and gets out of the way: the side
 * they last used, or the first-run question if they have never said. The
 * rules, including the migration for accounts that predate the question, are
 * `landingFor` in lib/auth/mode.ts.
 *
 * A signed-out visitor stays: the public page around this is for them.
 * Renders nothing either way.
 */
export function Landing() {
  const router = useRouter();
  const { state, recordMode } = useSession();
  // Adopting a mode changes the session, which re-runs this effect. One
  // decision per visit to the root is the decision.
  const decided = useRef(false);

  // Before paint, so a client-side arrival (sign-in replaces to "/") never
  // shows the public page for a frame on its way to the app.
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (state.status === "signed-in") html.setAttribute(RETURNING_ATTRIBUTE, "");
    if (state.status === "signed-out") html.removeAttribute(RETURNING_ATTRIBUTE);
  }, [state.status]);

  useEffect(() => {
    if (decided.current) return;
    const decision = rootDecision(state);
    if (decision.kind !== "go") return;
    decided.current = true;
    // Saved on the way past, never awaited: a coach from before the question
    // existed should reach their roster at the same speed as before.
    if (decision.adopt) void recordMode(decision.adopt);
    router.replace(decision.to);
  }, [state, router, recordMode]);

  return null;
}
