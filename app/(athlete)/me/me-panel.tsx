"use client";

import { useRouter } from "next/navigation";
import { CoachLink } from "@/components/coach/coach-link";
import { TrainingSettings } from "@/components/profile/training-settings";
import Link from "next/link";
import { InviteCodePanel } from "@/components/coach/invite-code";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/session";
import { useSession } from "@/lib/auth/session-context";

/**
 * Profile & Settings.
 *
 * Order 35 adds TRAINING -- name, sex, units -- to what Orders 15 and 16 had
 * already put here: who is signed in, the way out, the switch into coach mode,
 * the invite code, and the coach who can see this athlete's training.
 *
 * The blueprint's remaining rows belong elsewhere on purpose. Bodyweight is
 * Order 36. The load-suggestion toggle is Order 28 and is blocked on Ruairi --
 * it is a coaching philosophy question, not a product one. CSV export is
 * Order 39. The coach-side BILLING section waits for something to bill.
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

      <TrainingSettings />

      {/* The blueprint puts bodyweight in TRAINING as a row that opens its own
          screen, and reaches that screen from here or from Today. It is not a
          tab: a screen visited once a morning does not earn a permanent
          quarter of the bottom bar. */}
      <Link
        href="/bodyweight"
        className="flex items-center justify-between rounded-control border border-border px-3 py-2.5"
      >
        <span className="text-body">Bodyweight</span>
        <span className="text-ui text-muted">Log &amp; trend ›</span>
      </Link>

      <CoachLink />

      <InviteCodePanel />

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
