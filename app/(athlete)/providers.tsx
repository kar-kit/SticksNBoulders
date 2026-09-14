"use client";

import { useSession } from "@/lib/auth/session-context";
import { ExerciseLibraryProvider } from "@/lib/exercises/library-context";
import { TrainingSessionProvider } from "@/lib/logging/session-context";

/**
 * The two things every athlete screen needs loaded once, not per screen: the
 * exercise library and whether a session is running.
 *
 * Mounted inside the shell rather than in it, so the shell stays a layout
 * component with nothing to fetch -- and so its tests keep rendering without a
 * network. The shell only renders children when somebody is signed in, so
 * these never fetch for a signed-out visitor.
 */
export function AthleteProviders({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const athleteId = state.status === "signed-in" ? state.user.id : null;

  return (
    <ExerciseLibraryProvider userId={athleteId}>
      <TrainingSessionProvider athleteId={athleteId}>{children}</TrainingSessionProvider>
    </ExerciseLibraryProvider>
  );
}
