import type { SetTarget } from "@/lib/strength/suggestion";

/**
 * Where the next set of an exercise is meant to land: the reps and RPE a
 * prescription asks for.
 *
 * Always null today, and that is correct rather than unfinished. Prescriptions
 * reach the logger at Order 22, and the program table they live in arrives
 * with the Program Editor (Order 19), which is blocked on Ruairi's block-shape
 * question. The suggestion engine has no default target on purpose -- an
 * athlete with no prescription has nothing to suggest toward, and repeating
 * the previous set is already the right prefill (docs/suggestions.md).
 *
 * This is the seam Order 22 fills. Everything downstream of it -- the coach's
 * switch, the engine, the prefill note -- is wired and tested now, so when a
 * target exists the suggestion appears for athletes whose coach allows it and
 * not for the rest, with nothing else to change.
 */
export function setTargetFor(exerciseId: string): SetTarget | null {
  void exerciseId;
  return null;
}
