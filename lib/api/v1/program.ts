import { fetchExerciseNames } from "@/lib/export/training-log-store";
import { readMyProgram } from "@/lib/programming/program-read";
import { basisMaxesFor, lineSummaries, planDay, referenceLookup, targetsFor } from "@/lib/programming/session-plan";
import { DEFAULT_UNITS } from "@/lib/profile/profile";
import { readEstimatedMaxes, readReferenceMaxes } from "@/lib/strength/reference-max-read";
import { ok, ownProfile, type ApiResult, type ReadContext } from "./context";

/**
 * GET /api/v1/program/current (F29): the block the athlete sees on My
 * Program, with every percentage resolved to kilograms the way My Program
 * resolves it.
 *
 * The same calls, in the same order, as the day panel in
 * app/(athlete)/today/program/program-screen.tsx: readMyProgram (published
 * programs, published weeks, drafts filtered twice), the maxes from
 * reference_maxes and the rollups, `referenceLookup`, `planDay`,
 * `basisMaxesFor`, `targetsFor` with the athlete's unit, `lineSummaries`.
 * Nothing here does arithmetic of its own.
 *
 * The unit matters to the numbers, not just the words: a derived weight is
 * floored to the plates the athlete loads (2.5 kg, or 5 lb converted back),
 * so a pounds athlete's 75% is a different kilogram figure than a kilos
 * athlete's. `loadKg` is always kilograms; `summary` is My Program's line,
 * verbatim, in the athlete's unit.
 */
export async function currentProgram(ctx: ReadContext): Promise<ApiResult> {
  const source = { tables: ctx.tables, databaseId: ctx.databaseId };
  const [tree, entries, estimated, profile] = await Promise.all([
    readMyProgram(source, ctx.ownerId),
    readReferenceMaxes(ctx.tables, ctx.databaseId, ctx.ownerId),
    readEstimatedMaxes(ctx.tables, ctx.databaseId, ctx.ownerId),
    ownProfile(ctx),
  ]);
  const units = profile?.units ?? DEFAULT_UNITS;
  if (!tree) return ok({ units, program: null });

  const lines = tree.blocks.flatMap((b) => b.weeks.flatMap((w) => w.days.flatMap((d) => d.prescriptions)));
  const names = await fetchExerciseNames(ctx.tables, ctx.databaseId, [
    ...lines.map((line) => line.exerciseId),
    ...lines.map((line) => line.referenceExerciseId ?? "").filter(Boolean),
  ]);
  const nameOf = (id: string) => names.get(id) ?? null;
  const references = referenceLookup(entries, estimated, ctx.now, (id) => names.get(id));

  return ok({
    units,
    program: {
      id: tree.id,
      name: tree.name,
      startOn: tree.startOn,
      notes: tree.notes,
      updatedAt: tree.updatedAt,
      blocks: tree.blocks.map((block) => ({
        id: block.id,
        name: block.name,
        notes: block.notes,
        weeks: block.weeks.map((week) => ({
          id: week.id,
          label: week.label,
          notes: week.notes,
          days: week.days.map((day) => ({
            id: day.id,
            label: day.label,
            scheduledOn: day.scheduledOn,
            notes: day.notes,
            exercises: planDay(day.prescriptions).map((planned) => {
              const targets = targetsFor(
                planned,
                basisMaxesFor(planned.exerciseId, entries, estimated, ctx.now),
                [],
                references,
                units,
              );
              const summaries = lineSummaries(planned, targets);
              return {
                exercise: { id: planned.exerciseId, name: nameOf(planned.exerciseId) },
                lines: planned.lines.map((line, at) => ({
                  id: line.id,
                  summary: summaries[at],
                  setCount: line.setCount,
                  reps: line.reps,
                  repMax: line.repMax,
                  load: line.load,
                  loadKind: line.loadKind,
                  referenceExercise: line.referenceExerciseId
                    ? { id: line.referenceExerciseId, name: nameOf(line.referenceExerciseId) }
                    : null,
                  backoff: line.backoff ?? null,
                  warmupSets: line.warmupSets ?? null,
                  pauseSeconds: line.pauseSeconds ?? null,
                  restSeconds: line.restSeconds,
                  videoRequested: line.videoRequired === true,
                  notes: line.notes,
                  sets: targets
                    .filter((t) => t.prescriptionId === line.id)
                    .map((t) => ({
                      setNumber: t.setNumber,
                      backoff: Boolean(t.backoff),
                      loadKg: t.loadKg,
                      reps: t.reps,
                      repMax: t.repMax,
                      rpe: t.rpe,
                      kind: t.kind,
                      // A percentage with no max to resolve against: shown as
                      // the percentage, never guessed.
                      unresolved: t.unresolved,
                      display: t.display,
                    })),
                })),
              };
            }),
          })),
        })),
      })),
    },
  });
}
