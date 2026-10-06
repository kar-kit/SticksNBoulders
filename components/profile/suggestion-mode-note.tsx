"use client";

import { useSuggestionMode } from "@/lib/coach/use-suggestion-mode";

/**
 * Order 28 on Profile & Settings.
 *
 * The switch itself lives on the Athlete View, per athlete, because that is
 * where a coach decides about one person. This is the two other sides of it:
 *
 * - **The athlete** is told when their coach holds suggestions, so a logger
 *   that never suggests a load reads as a decision rather than a bug. Only
 *   when the answer is known: a device that has never read its link row
 *   assumes held, and saying "your coach has held them" on that guess would
 *   put words in a coach's mouth.
 * - **A coach** is told where the switch is.
 */
export function SuggestionModeNote({ athleteId, isCoach }: { athleteId: string; isCoach: boolean }) {
  const { mode, source } = useSuggestionMode(athleteId);
  const held = mode === "held" && source !== "unknown";
  if (!held && !isCoach) return null;

  return (
    <section aria-label="Load suggestions" className="flex flex-col items-start gap-1">
      <h2 className="m-0 text-caption font-semibold tracking-wide text-muted-2">LOAD SUGGESTIONS</h2>
      {held ? (
        <p className="m-0 text-ui text-muted">
          Your coach has load suggestions held, so the logger won’t suggest your next weight.
        </p>
      ) : null}
      {isCoach ? (
        <p className="m-0 text-ui text-muted">
          Whether each of your athletes sees suggested loads is set on their page in coach mode.
        </p>
      ) : null}
    </section>
  );
}
