import type { SetForEstimate } from "@/lib/strength/e1rm";
import { resolveMaxes, type EstimatedInput, type ReferenceMaxEntry } from "@/lib/strength/reference-max";
import type { RpeValue } from "@/lib/logging/set";
import { byPosition, type Prescription } from "./program";
import {
  parsePrescription,
  resolveExercise,
  sessionMaxFrom,
  type BasisMaxes,
  type PrescriptionKind,
  type PrescriptionSpec,
} from "./prescription";

/**
 * A prescribed day, turned into what the athlete's logger needs. Order 22.
 *
 * The coach writes lines -- "Squat 1 x 5 @8", "Squat 3 x 5 75%". The logger
 * works in sets. This expands one into the other, resolves every load against
 * the athlete's maxes with Order 18's resolver and rounding, and re-prices the
 * percentages off today's top set as it is logged.
 *
 * Nothing here writes. What the athlete logs is theirs: the target is a
 * prefill and a line of text, and the set that gets stored carries the
 * athlete's own numbers plus a snapshot of what the target said. A coach
 * editing the program afterwards changes the next target, never a logged set.
 *
 * Pure. No client, no network, no clock of its own.
 */

/** One exercise's lines, in the order the coach wrote them. */
export interface PlannedExercise {
  exerciseId: string;
  lines: Prescription[];
}

/**
 * Groups a day's lines by exercise, in the order each exercise first appears.
 *
 * By exercise rather than by contiguous run, because the logger groups sets by
 * exercise: a squat backoff written after the bench work is still squat, and
 * it is priced off today's squat top set -- which is exactly the precondition
 * `resolveExercise` states.
 */
export function planDay(prescriptions: readonly Prescription[]): PlannedExercise[] {
  const order: string[] = [];
  const lines = new Map<string, Prescription[]>();
  for (const line of byPosition(prescriptions)) {
    const list = lines.get(line.exerciseId);
    if (list) list.push(line);
    else {
      lines.set(line.exerciseId, [line]);
      order.push(line.exerciseId);
    }
  }
  return order.map((exerciseId) => ({ exerciseId, lines: lines.get(exerciseId)! }));
}

/** What one prescribed set asks for, resolved for this athlete right now. */
export interface SetTarget {
  prescriptionId: string;
  exerciseId: string;
  /** 1-based among this exercise's prescribed sets. */
  setNumber: number;
  totalSets: number;
  /** Null when the athlete picks the weight, or a percentage has no max. */
  loadKg: number | null;
  reps: number | null;
  repMax: number | null;
  /** An RPE target, or a capped prescription's ceiling. */
  rpe: RpeValue | null;
  kind: PrescriptionKind | null;
  /** The load as the athlete reads it: "152.5 kg (75%)", "RPE 8", or the coach's words. */
  display: string;
  /** Priced off today's top set rather than a stored max -- a suggestion, per Order 27. */
  synced: boolean;
  /** A percentage with nothing to resolve against. */
  unresolved: boolean;
  /** The set the synced weight was derived from, so the athlete can see why. */
  anchor: { loadKg: number; reps: number; rpe: number } | null;
  /**
   * The target in words, stored on the logged set: "5 reps · 152.5 kg (75%)".
   * This is the half of constraint 5 that lives on the athlete's side -- the
   * set remembers what it was an answer to, whatever the plan says later.
   */
  snapshot: string;
}

/**
 * The maxes a prescription on one exercise can resolve against, as of a date.
 *
 * Tested and training from reference_maxes, estimated from the rollups. The
 * session max is not here: it depends on what has been logged, and
 * `targetsFor` adds it.
 */
export function basisMaxesFor(
  exerciseId: string,
  entries: readonly ReferenceMaxEntry[],
  estimated: ReadonlyMap<string, EstimatedInput>,
  asOf: Date,
): BasisMaxes {
  const maxes = resolveMaxes(
    entries.filter((entry) => entry.exerciseId === exerciseId),
    asOf,
    estimated.get(exerciseId) ?? null,
  );
  return {
    tested: maxes.tested?.valueKg ?? null,
    training: maxes.training?.valueKg ?? null,
    estimated: maxes.estimated?.valueKg ?? null,
  };
}

/** "5", "8–10", or "" when the line leaves reps to the load cell. */
export function repsLabel(reps: number | null, repMax: number | null): string {
  if (reps === null) return "";
  return repMax !== null && repMax !== reps ? `${reps}–${repMax}` : String(reps);
}

function snapshotOf(reps: number | null, repMax: number | null, display: string): string {
  const r = repsLabel(reps, repMax);
  const repsPart = r ? `${r} rep${r === "1" ? "" : "s"}` : "";
  return [repsPart, display].filter(Boolean).join(" · ") || "as prescribed";
}

/**
 * Every prescribed set of one exercise, resolved against the athlete's maxes
 * and whatever they have logged of it so far this session.
 *
 * `logged` is this exercise's sets in this session, warm-ups included --
 * `resolveExercise` ignores the ones it cannot estimate from, which is the
 * safe direction. Re-run it after every set: that is what turns "75%" into a
 * weight priced off the top set the athlete just did.
 */
export function targetsFor(
  exercise: PlannedExercise,
  maxes: BasisMaxes,
  logged: readonly SetForEstimate[] = [],
): SetTarget[] {
  const slots: Array<{ line: Prescription; spec: PrescriptionSpec | null; setNumber: number }> = [];
  for (const line of exercise.lines) {
    const spec = line.load ? parsePrescription(line.load) : null;
    for (let i = 0; i < line.setCount; i++) {
      slots.push({ line, spec, setNumber: slots.length + 1 });
    }
  }

  const specs = slots.map((slot) => slot.spec).filter((spec): spec is PrescriptionSpec => spec !== null);
  const resolved = resolveExercise(specs, maxes, logged);
  const anchor = topSet(logged);

  let next = 0;
  return slots.map(({ line, spec, setNumber }) => {
    const r = spec === null ? null : resolved[next++];
    const display = r?.display ?? "";
    return {
      prescriptionId: line.id,
      exerciseId: exercise.exerciseId,
      setNumber,
      totalSets: slots.length,
      loadKg: r?.loadKg ?? null,
      reps: line.reps,
      repMax: line.repMax,
      rpe: r?.rpe ?? null,
      kind: spec?.kind ?? null,
      display,
      synced: r?.synced ?? false,
      unresolved: r?.unresolved ?? false,
      anchor: r?.synced ? anchor : null,
      snapshot: snapshotOf(line.reps, line.repMax, display),
    };
  });
}

/**
 * The logged set today's working max comes from: the one with the highest
 * estimate, the same choice `resolveExercise` makes.
 */
function topSet(logged: readonly SetForEstimate[]): SetTarget["anchor"] {
  let best: { set: SetForEstimate; kg: number } | null = null;
  for (const set of logged) {
    const kg = sessionMaxFrom(set);
    if (kg !== null && (best === null || kg > best.kg)) best = { set, kg };
  }
  if (!best || best.set.rpe === null) return null;
  return { loadKg: best.set.loadKg, reps: best.set.reps, rpe: best.set.rpe };
}

/**
 * The target for the athlete's next working set of an exercise, or null once
 * every prescribed set is done. Extra sets beyond the prescription are the
 * athlete's own and get no target -- they fall back to repeating the last set.
 *
 * Counted by working sets: warm-ups are never prescribed here, and "set 1" means
 * the first working set to the athlete and the coach alike.
 */
export function nextTarget(
  targets: readonly SetTarget[],
  logged: readonly { isWarmup?: boolean }[],
): SetTarget | null {
  const done = logged.filter((set) => !set.isWarmup).length;
  return targets[done] ?? null;
}

/**
 * One line per prescription, as the athlete reads it above the set rows and
 * on Today's card: "3 × 5 · 152.5 kg (75%)".
 *
 * Priced from the line's first set, which for a percentage line is the price
 * every set of it shares -- they resolve against the same max.
 */
export function lineSummaries(exercise: PlannedExercise, targets: readonly SetTarget[]): string[] {
  return exercise.lines.map((line) => {
    const first = targets.find((t) => t.prescriptionId === line.id);
    const reps = repsLabel(line.reps, line.repMax);
    const head = `${line.setCount} × ${reps || "—"}`;
    const load = first?.display ? ` · ${first.display}` : "";
    const why = first?.synced && first.anchor ? " (from today's top set)" : "";
    const note = line.notes ? ` — ${line.notes}` : "";
    return `${head}${load}${why}${note}`;
  });
}

/** "Set 2 of 4 · 5 reps · 152.5 kg (75%)" -- the next set, in one line. */
export function targetLine(target: SetTarget): string {
  return `Set ${target.setNumber} of ${target.totalSets} · ${target.snapshot}`;
}

/**
 * A target in the shape the set row's prefill expects.
 *
 * A weight priced off today's top set is a suggestion, not the coach's number,
 * so it goes to prefill's `suggested` source with the set it came from --
 * the mapping Order 18 left for this ticket. Everything else is `prescribed`.
 */
export function prefillFrom(target: SetTarget | null) {
  if (!target) return { prescription: null, suggestion: null };
  if (target.synced && target.loadKg !== null && target.anchor) {
    return {
      prescription: { loadKg: null, reps: target.reps },
      suggestion: {
        loadKg: target.loadKg,
        reps: target.reps,
        fromRpe: target.anchor.rpe,
        fromLoadKg: target.anchor.loadKg,
      },
    };
  }
  return { prescription: { loadKg: target.loadKg, reps: target.reps }, suggestion: null };
}
