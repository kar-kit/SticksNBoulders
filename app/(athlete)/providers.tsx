"use client";

import { useRecordMode, useSession } from "@/lib/auth/session-context";
import { ExerciseLibraryProvider } from "@/lib/exercises/library-context";
import { TrainingSessionProvider } from "@/lib/logging/session-context";
import { UnitsProvider } from "@/lib/profile/units-context";

/**
 * The things every athlete screen needs loaded once, not per screen: the
 * exercise library, whether a session is running, and the weight unit every
 * load is typed and read in.
 *
 * Mounted inside the shell rather than in it, so the shell stays a layout
 * component with nothing to fetch -- and so its tests keep rendering without a
 * network. The shell only renders children when somebody is signed in, so
 * these never fetch for a signed-out visitor.
 *
 * Also where the athlete side records itself as the side in use, so the next
 * sign-in opens here (last-used wins; lib/auth/mode.ts).
 */
export function AthleteProviders({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  useRecordMode("athlete");
  const athleteId = state.status === "signed-in" ? state.user.id : null;

  return (
    <UnitsProvider userId={athleteId}>
      <ExerciseLibraryProvider userId={athleteId}>
        <TrainingSessionProvider athleteId={athleteId}>{children}</TrainingSessionProvider>
      </ExerciseLibraryProvider>
    </UnitsProvider>
  );
}
