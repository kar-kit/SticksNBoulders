"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/session";
import { useSession } from "@/lib/auth/session-context";

/**
 * Profile & Settings is Order 35. What exists here now is what the shell needs:
 * who is signed in, the way out, and the switch into coach mode for someone who
 * has athletes.
 */
export function MePanel() {
  const router = useRouter();
  const { state, refresh } = useSession();
  if (state.status !== "signed-in") return null;

  return (
    <div className="pt-safe-8 flex flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">Me</h1>

      <div className="flex flex-col gap-1">
        <span className="text-title font-semibold">{state.user.name}</span>
        <span className="text-body text-muted">{state.user.email}</span>
      </div>

      {/* Shown only when athletes are linked. Role is a relationship, so this
          appears and disappears on its own as links are made and revoked. */}
      {state.coach.isCoach ? (
        <Button variant="secondary" onClick={() => router.push("/coach/roster")}>
          Coach mode
          <span className="ml-2 font-mono text-caption text-muted-2">
            {state.coach.athleteIds.length}
          </span>
        </Button>
      ) : null}

      <Button
        variant="secondary"
        onClick={async () => {
          await signOut();
          // Told before navigating, or sign-in reads a stale session and sends
          // them straight back into the app they just left.
          await refresh();
          router.replace("/sign-in");
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
