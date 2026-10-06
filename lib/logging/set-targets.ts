import type { SetTarget } from "@/lib/strength/suggestion";
import type { SetTarget as PrescribedTarget } from "@/lib/programming/session-plan";

/**
 * Where the next set of an exercise is meant to land: the reps and RPE a
 * prescription asks for. The seam Order 28 left for Order 22.
 *
 * Takes the prescribed target for the set about to be planned (see
 * `nextTarget` in lib/programming/session-plan) and keeps only what the
 * suggestion engine works from. Null when nothing is prescribed, when the line
 * names no RPE (a fixed weight or a bare percentage has nothing to autoregulate
 * toward), or names no rep count. The engine deliberately has no default
 * target (docs/suggestions.md): no prescription, no suggestion.
 *
 * Null for a backoff set too (Order 21). Its load is the coach's rule executed
 * against the top set, and a drop-until-RPE rule's RPE is where the run STOPS,
 * not a target to aim the next set at -- handing it to the engine would have
 * the app argue with the coach's number.
 */
export function setTargetFor(target: PrescribedTarget | null): SetTarget | null {
  if (!target || target.backoff || target.rpe === null || target.reps === null) return null;
  return { reps: target.reps, rpe: target.rpe };
}
