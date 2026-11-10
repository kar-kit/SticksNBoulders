import { fetchExerciseNames } from "@/lib/export/training-log-store";
import { DEFAULT_UNITS } from "@/lib/profile/profile";
import { preferredMax, resolveMaxes, type ResolvedMax } from "@/lib/strength/reference-max";
import { readEstimatedMaxes, readReferenceMaxes } from "@/lib/strength/reference-max-read";
import { ok, ownProfile, type ApiResult, type ReadContext } from "./context";

/**
 * GET /api/v1/maxes (F29): per lift, the training and tested max in effect
 * today and the best e1RM, as the app resolves them.
 *
 * `resolveMaxes` picks each kind the way every screen does: the newest entry
 * in effect by now (a max dated next block is not in effect yet), ties to the
 * later-written row. The e1RM is the best `best_e1rm_kg` across the rollups,
 * never recomputed from sets. `preferred` is the one a bare percentage uses:
 * training, then tested, then e1RM.
 */

const shape = (max: ResolvedMax | null) => (max ? { valueKg: max.valueKg, asOf: max.asOf } : null);

export async function maxes(ctx: ReadContext): Promise<ApiResult> {
  const [entries, estimated, profile] = await Promise.all([
    readReferenceMaxes(ctx.tables, ctx.databaseId, ctx.ownerId),
    readEstimatedMaxes(ctx.tables, ctx.databaseId, ctx.ownerId),
    ownProfile(ctx),
  ]);
  const exerciseIds = [...new Set([...entries.map((e) => e.exerciseId), ...estimated.keys()])];
  const names = await fetchExerciseNames(ctx.tables, ctx.databaseId, exerciseIds);

  const lifts = exerciseIds
    .map((exerciseId) => {
      const resolved = resolveMaxes(
        entries.filter((e) => e.exerciseId === exerciseId),
        ctx.now,
        estimated.get(exerciseId) ?? null,
      );
      const preferred = preferredMax(resolved);
      return {
        exercise: { id: exerciseId, name: names.get(exerciseId) ?? null },
        training: shape(resolved.training),
        tested: shape(resolved.tested),
        bestE1rm: shape(resolved.estimated),
        preferred: preferred ? { kind: preferred.kind, valueKg: preferred.valueKg } : null,
      };
    })
    // Only maxes dated in the future: nothing in effect yet, so nothing to say.
    .filter((lift) => lift.training || lift.tested || lift.bestE1rm)
    .sort((a, b) => (a.exercise.name ?? "￿").localeCompare(b.exercise.name ?? "￿") || a.exercise.id.localeCompare(b.exercise.id));

  return ok({ units: profile?.units ?? DEFAULT_UNITS, asOf: ctx.now.toISOString(), lifts });
}
