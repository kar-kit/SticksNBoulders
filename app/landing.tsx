"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ATHLETE_HOME, COACH_HOME } from "@/lib/auth/destinations";
import { useSession } from "@/lib/auth/session-context";

/**
 * The root decides where someone belongs and gets out of the way. A coach lands
 * on their roster; everyone else on Today.
 */
export function Landing() {
  const router = useRouter();
  const { state } = useSession();

  useEffect(() => {
    if (state.status === "loading") return;
    if (state.status === "signed-out") router.replace("/sign-in");
    else router.replace(state.coach.isCoach ? COACH_HOME : ATHLETE_HOME);
  }, [state, router]);

  return <div className="min-h-dvh bg-background" aria-busy="true" />;
}
