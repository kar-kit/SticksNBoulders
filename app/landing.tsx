"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { landingFor } from "@/lib/auth/mode";
import { useSession } from "@/lib/auth/session-context";

/**
 * The root decides where someone belongs and gets out of the way: the side
 * they last used, or the first-run question if they have never said. The
 * rules, including the migration for accounts that predate the question, are
 * `landingFor` in lib/auth/mode.ts.
 */
export function Landing() {
  const router = useRouter();
  const { state, recordMode } = useSession();
  // Adopting a mode changes the session, which re-runs this effect. One
  // decision per visit to the root is the decision.
  const decided = useRef(false);

  useEffect(() => {
    if (state.status === "loading" || decided.current) return;
    decided.current = true;
    const signedIn = state.status === "signed-in";
    const landing = landingFor({
      signedIn,
      mode: signedIn ? state.prefs.mode : null,
      hasLinks: signedIn && state.coach.isCoach,
      offline: signedIn && state.offline,
    });
    // Saved on the way past, never awaited: a coach from before the question
    // existed should reach their roster at the same speed as before.
    if (landing.adopt) void recordMode(landing.adopt);
    router.replace(landing.to);
  }, [state, router, recordMode]);

  return <div className="min-h-dvh bg-background" aria-busy="true" />;
}
