"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CoachLink } from "@/components/coach/coach-link";
import { TrainingSettings } from "@/components/profile/training-settings";
import { PhotoSettings } from "@/components/profile/photo-settings";
import { SuggestionModeNote } from "@/components/profile/suggestion-mode-note";
import Link from "next/link";
import { InviteCodePanel } from "@/components/coach/invite-code";
import { ExportLog } from "@/components/export/export-log";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/session";
import { useSession } from "@/lib/auth/session-context";
import { COACH_HOME } from "@/lib/auth/destinations";
import { canCoach } from "@/lib/auth/mode";
import { hasUnsynced } from "@/lib/offline/client";

/**
 * Profile & Settings.
 *
 * Order 35 adds TRAINING -- name, sex, units -- to what Orders 15 and 16 had
 * already put here: who is signed in, the way out, the switch into coach mode,
 * the invite code, and the coach who can see this athlete's training.
 *
 * Order 39 adds DATA: the training log as a CSV.
 *
 * Order 28's load-suggestion switch is per athlete and lives on the Athlete
 * View; LOAD SUGGESTIONS here tells an athlete when their coach holds them,
 * and tells a coach where the switch is.
 *
 * The blueprint's remaining rows belong elsewhere on purpose. Bodyweight is
 * Order 36. The coach-side BILLING section waits for something to bill.
 */
export function MePanel() {
  const router = useRouter();
  const { state, refresh } = useSession();
  if (state.status !== "signed-in") return null;

  return (
    <div className="pt-8 flex flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">Me</h1>

      <div className="flex flex-col gap-1">
        <span className="text-title font-semibold">{state.user.name}</span>
        <span className="text-body text-muted">{state.user.email}</span>
      </div>

      <PhotoSettings userId={state.user.id} name={state.user.name} />

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

      {/* The lifts this athlete typed into existence, which until now could
          only be seen in the typeahead and never corrected. */}
      <Link
        href="/me/exercises"
        className="flex items-center justify-between rounded-control border border-border px-3 py-2.5"
      >
        <span className="text-body">My exercises</span>
        <span className="text-ui text-muted">Rename &amp; tidy ›</span>
      </Link>

      <CoachLink />

      <SuggestionModeNote athleteId={state.user.id} isCoach={state.coach.isCoach} />

      <InviteCodePanel />

      <ExportLog athleteId={state.user.id} athleteName={state.user.name} audience="athlete" />

      {/* For anyone with athletes linked, and for anyone who has chosen coach
          -- a coach with none yet needs this to reach the invite code on the
          roster. It used to need a link, which a new coach does not have. */}
      {canCoach(state.prefs, state.coach.isCoach) ? (
        <Button variant="secondary" onClick={() => router.push(COACH_HOME)}>
          Coach mode
          {state.coach.athleteIds.length > 0 ? (
            <span className="ml-2 font-mono text-caption text-muted-2">
              {state.coach.athleteIds.length}
            </span>
          ) : null}
        </Button>
      ) : null}

      <SignOutButton
        onSignOut={async () => {
          await signOut();
          // Told before navigating, or sign-in reads a stale session and sends
          // them straight back into the app they just left.
          await refresh();
          router.replace("/sign-in");
        }}
      />
    </div>
  );
}

/**
 * Sign out, with a word first if training is still waiting to sync.
 *
 * Nothing is lost by signing out -- the queue holds it for this athlete -- but
 * it only sends once they sign in on this phone again. On a borrowed phone
 * that may be never, and that is worth one extra tap to know.
 */
export function SignOutButton({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [warning, setWarning] = useState(false);

  if (warning) {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <p className="m-0 text-body">
          Some of your training hasn&rsquo;t synced yet. It stays on this phone and sends the next time you
          sign in here.
        </p>
        <div className="flex gap-3">
          <Button block variant="secondary" onClick={() => setWarning(false)}>
            Stay signed in
          </Button>
          <Button block onClick={() => void onSignOut()}>
            Sign out anyway
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      onClick={async () => {
        if (hasUnsynced()) {
          setWarning(true);
          return;
        }
        await onSignOut();
      }}
    >
      Sign out
    </Button>
  );
}
