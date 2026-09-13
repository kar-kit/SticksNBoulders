import type { WorkoutSet } from "./types";

/** Epley formula: a single is its own tested max, otherwise extrapolate from reps. */
export function epley1RM(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
}

export interface Best1RM {
  estimatedKg: number;
  sourceSet: WorkoutSet;
}

/** Best estimated 1RM across a lift's history, from its best qualifying (non-warmup) set. */
export function computeBest1RM(sets: WorkoutSet[]): Best1RM | null {
  const working = sets.filter((s) => !s.isWarmup);
  if (working.length === 0) return null;

  let best: Best1RM | null = null;
  for (const set of working) {
    const estimatedKg = epley1RM(set.weightKg, set.reps);
    if (!best || estimatedKg > best.estimatedKg) {
      best = { estimatedKg, sourceSet: set };
    }
  }
  return best;
}

const MAX_REP_PR_BRACKET = 12;

/** Heaviest weight ever lifted at each rep count, 1..12, for a rep-PR table. */
export function computeRepPRs(sets: WorkoutSet[]): Map<number, number> {
  const prs = new Map<number, number>();
  for (const set of sets) {
    if (set.isWarmup || set.reps < 1 || set.reps > MAX_REP_PR_BRACKET) continue;
    const current = prs.get(set.reps);
    if (current === undefined || set.weightKg > current) {
      prs.set(set.reps, set.weightKg);
    }
  }
  return prs;
}
