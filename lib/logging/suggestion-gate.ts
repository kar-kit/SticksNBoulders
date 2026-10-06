import type { SuggestionMode } from "@/lib/coach/suggestion-mode";
import { suggestLoad, type LoggedSet, type SetTarget } from "@/lib/strength/suggestion";
import type { Suggestion } from "./prefill";

/**
 * The single point a next-set load suggestion can enter the logger, and the
 * coach's switch on it (Order 28).
 *
 * Order 27 built the engine and left it unwired, because wiring it would have
 * answered "direct or held?" by default. With the switch in place it can be
 * wired, behind this gate:
 *
 * - **held** -- nothing, whatever the engine would say. The row repeats the
 *   set just logged (prefill rule 3), the behaviour before Order 27 existed.
 * - **direct** -- the engine's answer, which prefill ranks second and marks
 *   "suggested from RPE 7 @ 170". Always editable, never locked.
 *
 * Either way, no target means no suggestion. The engine deliberately has no
 * default target (docs/suggestions.md): the target RPE comes from a
 * prescription, and until the logger reads prescriptions (Order 22) there is
 * nothing to suggest toward. See set-targets.ts.
 *
 * Pure. The mode comes from the caller, which reads it from the link row or,
 * offline, from the last copy it saw.
 */
export function nextSetSuggestion(
  mode: SuggestionMode,
  logged: LoggedSet,
  target: SetTarget | null,
): Suggestion | null {
  if (mode !== "direct") return null;
  if (!target) return null;
  const suggestion = suggestLoad(logged, target);
  if (!suggestion) return null;
  return {
    loadKg: suggestion.loadKg,
    reps: target.reps,
    fromRpe: suggestion.fromRpe,
    fromLoadKg: suggestion.fromLoadKg,
  };
}
