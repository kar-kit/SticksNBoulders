import type { SetForEstimate } from "@/lib/strength/e1rm";
import { resolveMaxes, type EstimatedInput, type ReferenceMaxEntry } from "@/lib/strength/reference-max";
import type { RpeValue } from "@/lib/logging/set";
import { resolvePrefill } from "@/lib/logging/prefill";
import type { PlannedRow } from "@/lib/logging/plan";
import { loadNumber, type UnitPreference } from "@/lib/units";
import { byPosition, type Prescription } from "./program";
import {
  backoffDisplay,
  backoffLoad,
  backoffRun,
  readBackoff,
  topSetOf,
  type BackoffRule,
  type TopSet,
} from "./backoff";
import {
  parsePrescription,
  resolveExercise,
  resolvePrescription,
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
   * Set when this set is a backoff executed from the line's rule (Order 21):
   * the rule, and the top set it was priced off -- null until the athlete has
   * logged one. Absent on every other set.
   */
  backoff?: { rule: BackoffRule; topSet: TopSet | null };
  /**
   * The target in words, stored on the logged set: "5 reps · 152.5 kg (75%)".
   * This is the half of constraint 5 that lives on the athlete's side -- the
   * set remembers what it was an answer to, whatever the plan says later.
   *
   * Always in kilos: the coach reads it back, and storage is kilos.
   */
  snapshot: string;
  /**
   * The snapshot in the athlete's unit, for the logger's "Next:" line. Only
   * set when that unit is not kilos; everywhere else the snapshot is it.
   */
  shown?: string;
  /**
   * The coach asked for a clip of this set (Order 30). Set on a flagged
   * line's own sets, never on the backoffs its rule adds: the clip the coach
   * wants is of the top set, the same rule `videoAsk` counts by.
   */
  videoRequired?: boolean;
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

/**
 * Where a reference row (`70% of Bench Press` on a Tempo Bench line) finds the
 * other lift's maxes and its name. Both are already on the device: maxes are
 * fetched for every exercise, not filtered, and names come from the library
 * the typeahead loads.
 */
export interface ReferenceLookup {
  maxesFor: (exerciseId: string) => BasisMaxes;
  nameOf: (exerciseId: string) => string | null | undefined;
}

/** A `ReferenceLookup` over the same maxes `basisMaxesFor` reads, as of the same date. */
export function referenceLookup(
  entries: readonly ReferenceMaxEntry[],
  estimated: ReadonlyMap<string, EstimatedInput>,
  asOf: Date,
  nameOf: (exerciseId: string) => string | null | undefined,
): ReferenceLookup {
  return { maxesFor: (exerciseId) => basisMaxesFor(exerciseId, entries, estimated, asOf), nameOf };
}

/**
 * The lift a line's percentage is OF, when it is not the line's own -- or null.
 *
 * Consulted only for a percentage: the column survives a coach changing `70%`
 * to `@8` and back, and means nothing in between. A self-reference is the
 * line's own exercise (the write helper stores it as null; this is the same
 * rule on the read side).
 */
export function referenceOf(line: Prescription, spec: PrescriptionSpec | null): string | null {
  const id = line.referenceExerciseId ?? null;
  if (!id || id === line.exerciseId) return null;
  return spec?.kind === "percent" || spec?.kind === "capped" ? id : null;
}

/** Said when the library has not given the reference lift a name yet. */
const UNNAMED_REFERENCE = "the reference lift";

/** "5", "8–10", or "" when the line leaves reps to the load cell. */
export function repsLabel(reps: number | null, repMax: number | null): string {
  if (reps === null) return "";
  return repMax !== null && repMax !== reps ? `${reps}–${repMax}` : String(reps);
}

/**
 * "5 reps · 2s pause · 152.5 kg (75%)". The pause sits beside the reps it
 * applies to, as in `lineSummaries`, so the snapshot stored on the set -- and
 * the CSV export that reads it -- carries it.
 */
function snapshotOf(reps: number | null, repMax: number | null, display: string, pauseSeconds?: number | null): string {
  const r = repsLabel(reps, repMax);
  const repsPart = r ? `${r} rep${r === "1" ? "" : "s"}` : "";
  const pause = pauseSeconds ? `${pauseSeconds}s pause` : "";
  return [repsPart, pause, display].filter(Boolean).join(" · ") || "as prescribed";
}

/**
 * Every prescribed set of one exercise, resolved against the athlete's maxes
 * and whatever they have logged of it so far this session.
 *
 * `logged` is this exercise's sets in this session, warm-ups included --
 * `resolveExercise` ignores the ones it cannot estimate from, which is the
 * safe direction. Re-run it after every set: that is what turns "75%" into a
 * weight priced off the top set the athlete just did.
 *
 * A line whose percentage is of another lift (`reference_exercise_id`) is
 * priced off THAT lift's stored max through `references`, and never off this
 * exercise's sets: a tempo bench set at RPE 8 measures tempo bench, not comp
 * bench. Phase 1 of docs/reference-lift.md §2 -- it behaves like a named kind,
 * never `synced`. Without `references` such a line resolves to nothing rather
 * than falling back to this exercise's max: the coach said "of bench".
 *
 * `unit` is the athlete's display unit: it picks the plates a derived weight
 * is floored to and the words `display` uses. The snapshot is kilos regardless.
 */
export function targetsFor(
  exercise: PlannedExercise,
  maxes: BasisMaxes,
  logged: readonly SetForEstimate[] = [],
  references?: ReferenceLookup,
  unit: UnitPreference = "kg",
): SetTarget[] {
  // The athlete-unit snapshot, on the targets of an athlete who reads pounds.
  const shownOf = (line: Prescription, words: string) =>
    unit === "kg" ? {} : { shown: snapshotOf(line.reps, line.repMax, words, line.pauseSeconds) };
  type Slot =
    | { line: Prescription; spec: PrescriptionSpec | null; backoff?: undefined; reference?: string | null }
    | { line: Prescription; spec: null; backoff: { rule: BackoffRule; topSet: TopSet | null }; reference?: undefined };
  // A flagged line's own sets carry the coach's video ask; backoffs never do.
  const flagged = (line: Prescription) => (line.videoRequired ? { videoRequired: true } : {});
  // Working sets in the order they were logged: slot n is answered by the nth.
  // Warm-ups never fill a slot, and never count as a top set.
  const working = logged.filter((set) => !set.isWarmup);
  const slots: Slot[] = [];
  for (const line of exercise.lines) {
    const spec = line.load ? parsePrescription(line.load) : null;
    const reference = referenceOf(line, spec);
    const first = slots.length;
    for (let i = 0; i < line.setCount; i++) slots.push({ line, spec, reference });
    const rule = readBackoff(line.backoff);
    if (!rule) continue;
    // The top set is the heaviest of the sets logged against this line's own
    // slots -- the athlete's actual weight, never the prescribed one.
    const topSet = topSetOf(working.slice(first, slots.length));
    const run = backoffRun(rule, working.slice(slots.length));
    for (let i = 0; i < run.sets; i++) slots.push({ line, spec: null, backoff: { rule, topSet } });
  }

  // Own-exercise specs resolve together against today's sets, exactly as
  // before; reference rows are kept out of that and priced on their own.
  const specs = slots
    .filter((slot) => !slot.reference)
    .map((slot) => slot.spec)
    .filter((spec): spec is PrescriptionSpec => spec !== null);
  const resolved = resolveExercise(specs, maxes, logged, unit);
  const anchor = topSet(logged);

  let next = 0;
  return slots.map((slot, at) => {
    const { line, spec } = slot;
    const setNumber = at + 1;
    const base = {
      prescriptionId: line.id,
      exerciseId: exercise.exerciseId,
      setNumber,
      totalSets: slots.length,
      reps: line.reps,
      repMax: line.repMax,
    };
    if (slot.backoff) {
      // The coach's rule, executed: a prescribed number, not an engine
      // suggestion, so not `synced`. No top set yet means no load -- the
      // athlete reads the rule and the row falls back to repeating.
      const { rule, topSet } = slot.backoff;
      const loadKg = topSet ? backoffLoad(rule, topSet.loadKg, unit) : null;
      const display = backoffDisplay(rule, loadKg, unit);
      return {
        ...base,
        loadKg,
        rpe: rule.kind === "drop" ? rule.untilRpe : null,
        kind: null,
        display,
        synced: false,
        unresolved: loadKg === null,
        anchor: null,
        backoff: { rule, topSet },
        snapshot: snapshotOf(line.reps, line.repMax, backoffDisplay(rule, loadKg), line.pauseSeconds),
        ...shownOf(line, display),
      };
    }
    if (slot.reference && spec) {
      const name = references?.nameOf(slot.reference) || UNNAMED_REFERENCE;
      const own = references?.maxesFor(slot.reference) ?? {};
      const r = resolvePrescription(spec, { ...own, session: null }, { name }, unit);
      return {
        ...base,
        loadKg: r.loadKg,
        rpe: r.rpe,
        kind: spec.kind,
        display: r.display,
        synced: false,
        unresolved: r.unresolved,
        anchor: null,
        snapshot: snapshotOf(line.reps, line.repMax, r.record ?? r.display, line.pauseSeconds),
        ...shownOf(line, r.shown ?? r.display),
        ...flagged(line),
      };
    }
    const r = spec === null ? null : resolved[next++];
    const display = r?.display ?? "";
    return {
      ...base,
      loadKg: r?.loadKg ?? null,
      rpe: r?.rpe ?? null,
      kind: spec?.kind ?? null,
      display,
      synced: r?.synced ?? false,
      unresolved: r?.unresolved ?? false,
      anchor: r?.synced ? anchor : null,
      snapshot: snapshotOf(line.reps, line.repMax, r?.record ?? display, line.pauseSeconds),
      ...shownOf(line, display),
      ...flagged(line),
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
 * Counted by working sets: warm-ups never get a target here (a line's
 * `warmupSets` become blank rows the athlete loads themselves, see
 * `remainingShape`), and "set 1" means the first working set to the athlete
 * and the coach alike.
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
 * on Today's card: "3 × 5 · 152.5 kg (75%)", and with v15's two fields
 * "3 × 5 · 2s pause · 152.5 kg (75%) · +2 warm-up".
 *
 * The pause sits beside the reps it applies to; the warm-up count follows the
 * line's own sets, before any backoff, because the warm-ups lead into the top
 * set and are not part of the working sets the rest of the line describes.
 * Zero of either reads as none. A line the coach wants filmed says
 * "video requested". The logger lays the warm-ups out as rows of their own
 * (`remainingShape`), and the pause also rides in the snapshot stored on each
 * set; the video ask does not, because the clip itself is the record of it.
 *
 * Priced from the line's first set, which for a percentage line is the price
 * every set of it shares -- they resolve against the same max.
 */
export function lineSummaries(exercise: PlannedExercise, targets: readonly SetTarget[]): string[] {
  return exercise.lines.map((line) => {
    const first = targets.find((t) => t.prescriptionId === line.id && !t.backoff);
    const reps = repsLabel(line.reps, line.repMax);
    const head = `${line.setCount} × ${reps || "—"}`;
    const pause = line.pauseSeconds ? ` · ${line.pauseSeconds}s pause` : "";
    const load = first?.display ? ` · ${first.display}` : "";
    const why = first?.synced && first.anchor ? " (from today's top set)" : "";
    const warmup = line.warmupSets ? ` · +${line.warmupSets} warm-up` : "";
    const video = line.videoRequired ? " · video requested" : "";
    const note = line.notes ? ` — ${line.notes}` : "";
    return `${head}${pause}${load}${why}${warmup}${backoffSummary(line, targets)}${video}${note}`;
  });
}

/** ", then 3 × 5 · 162.5 kg (90% of top set)" for a line with a backoff rule. */
function backoffSummary(line: Prescription, targets: readonly SetTarget[]): string {
  const backoffs = targets.filter((t) => t.prescriptionId === line.id && t.backoff);
  const first = backoffs[0];
  if (!first?.backoff) return "";
  const reps = repsLabel(line.reps, line.repMax) || "—";
  const count = first.backoff.rule.kind === "percent" ? `${backoffs.length} × ${reps}` : `sets of ${reps}`;
  return `, then ${count} · ${first.display}`;
}

/**
 * "Set 2 of 4 · 5 reps · 152.5 kg (75%)" -- the next set, in one line, with
 * " · film this set" when the coach asked for a clip of it.
 */
export function targetLine(target: SetTarget): string {
  // A drop-until-RPE run has no fixed length, so it has no "of".
  const of = target.backoff?.rule.kind === "drop" ? "" : ` of ${target.totalSets}`;
  const film = target.videoRequired ? " · film this set" : "";
  return `Set ${target.setNumber}${of} · ${target.shown ?? target.snapshot}${film}`;
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

/** The fields prescription targets are computed from. */
export type LoggedForTarget = { loadKg: number; reps: number; rpe?: number | null; isWarmup?: boolean };

/**
 * Gives rows that have just appeared in the logger's plan the coach's target
 * for the set each one will be.
 *
 * Only new rows -- ones absent from `before` -- are touched. A row already on
 * screen holds whatever the athlete typed into it, and re-pricing it under
 * their thumb would be the app arguing with them. A new row's position is
 * counted in working sets: those logged, plus the working rows planned ahead
 * of it, so the third row of a 3 x 5 gets set 3's target.
 *
 * Load and reps fall back independently through the prefill order: an RPE
 * line with no weight keeps the repeated load, and an extra set beyond the
 * prescription is left exactly as `lib/logging/plan` built it.
 *
 * `reprice` names rows already on screen that should be priced again as if
 * new: rows laid out up front that the athlete has not touched, after a set
 * is logged ahead of them. A backoff laid out before its top set existed has
 * no weight until then; this is when it gets one.
 */
export function prescribeNewRows(
  before: readonly PlannedRow[],
  after: readonly PlannedRow[],
  context: (exerciseId: string) => { logged: readonly LoggedForTarget[]; targets: readonly SetTarget[] | null },
  unit: UnitPreference = "kg",
  reprice: ReadonlySet<string> = new Set(),
): PlannedRow[] {
  const seen = new Set(before.map((row) => row.clientSetId).filter((id) => !reprice.has(id)));
  if (after.every((row) => seen.has(row.clientSetId))) return [...after];
  const cache = new Map<string, ReturnType<typeof context>>();
  const of = (exerciseId: string) => {
    let hit = cache.get(exerciseId);
    if (!hit) cache.set(exerciseId, (hit = context(exerciseId)));
    return hit;
  };
  return after.map((row, at) => {
    if (seen.has(row.clientSetId) || row.isWarmup) return row;
    const { logged, targets } = of(row.exerciseId);
    if (!targets) return row;
    const ahead = after.slice(0, at).filter((r) => r.exerciseId === row.exerciseId && !r.isWarmup).length;
    const done = logged.filter((set) => !set.isWarmup).length;
    const target = targets[done + ahead] ?? null;
    if (!target) return row;
    const prefill = resolvePrefill({
      ...prefillFrom(target),
      unit,
      previousSetThisSession:
        row.loadKg !== null && row.reps !== null ? { loadKg: row.loadKg, reps: row.reps } : null,
    });
    // A backoff load says which set it was priced off, so the athlete can
    // see the coach's rule rather than an unexplained number.
    const fromBackoff = prefill.source === "prescribed" ? backoffNote(target, unit) : null;
    return {
      ...row,
      loadKg: prefill.loadKg,
      reps: prefill.reps,
      // A coach's number replacing an engine suggestion takes its note with
      // it; a load priced off today's top set says where it came from.
      note: fromBackoff ?? (prefill.loadKg === row.loadKg ? (row.note ?? prefill.note) : prefill.note),
      // Suggested while the load is still an engine's number: a weight priced
      // off today's top set is one, and so is a suggestion the row already
      // held. A coach's prescribed load is neither.
      suggested: prefill.source === "suggested" || (prefill.source !== "prescribed" && row.suggested === true),
      prescriptionId: target.prescriptionId,
      prescribed: target.snapshot,
      ...(target.videoRequired ? { videoRequired: true } : {}),
    };
  });
}

/** One row the logger should lay out for a prescribed exercise: a warm-up or a working set. */
export interface RowShape {
  isWarmup: boolean;
}

/**
 * The rows still to do of a prescribed exercise, in order: each line's
 * warm-ups (v15 `warmup_sets`) ahead of its first working set, then one
 * working row per prescribed set not yet logged, backoffs included.
 *
 * Built from the same positional rule as `nextTarget`: logged working sets
 * answer targets in order. A line already under way gets no warm-ups -- the
 * athlete is past them. A line not started gets its count less any warm-ups
 * already logged since the working set before it, so a reload after two of
 * three warm-ups lays out one more, not three.
 *
 * Warm-ups carry no load or target. The athlete picks their own ramp, and a
 * warm-up never answers a prescription line (see the logger's confirm).
 */
export function remainingShape(
  exercise: PlannedExercise,
  targets: readonly SetTarget[],
  logged: readonly { isWarmup?: boolean }[],
): RowShape[] {
  const warmupsOf = new Map(exercise.lines.map((line) => [line.id, Math.max(0, line.warmupSets ?? 0)]));
  // Warm-ups already logged, credited to the line whose working set they led into.
  const credited = new Map<string, number>();
  let working = 0;
  for (const set of logged) {
    if (!set.isWarmup) {
      working += 1;
      continue;
    }
    const line = targets[working]?.prescriptionId;
    if (line) credited.set(line, (credited.get(line) ?? 0) + 1);
  }
  const shape: RowShape[] = [];
  for (let at = working; at < targets.length; at++) {
    const target = targets[at];
    const first = !target.backoff && targets.findIndex((t) => t.prescriptionId === target.prescriptionId) === at;
    if (first) {
      const owed = (warmupsOf.get(target.prescriptionId) ?? 0) - (credited.get(target.prescriptionId) ?? 0);
      for (let i = 0; i < owed; i++) shape.push({ isWarmup: true });
    }
    shape.push({ isWarmup: false });
  }
  return shape;
}

/**
 * Targets as they apply to a variant the athlete swapped to: the coach's
 * reps, RPE and words, but no load. A weight priced for Barbell Row is not a
 * weight for Dumbbell Row, so the row falls back to the variant's own last set
 * (or empty) rather than prefilling a number for the wrong implement.
 *
 * The snapshot names the exercise the coach wrote, so the set's stored text
 * -- what Review and the CSV show next to the swapped lift -- says what it
 * was an answer to: "5 reps · RPE 8 · prescribed Barbell Row".
 */
export function asVariant(targets: readonly SetTarget[], prescribedName: string): SetTarget[] {
  return targets.map((target) => ({
    ...target,
    loadKg: null,
    synced: false,
    anchor: null,
    snapshot: `${target.snapshot} · prescribed ${prescribedName}`,
    ...(target.shown ? { shown: `${target.shown} · prescribed ${prescribedName}` } : {}),
  }));
}

/** "backoff from top set 180 × 3": why a backoff row holds the load it does. */
export function backoffNote(target: SetTarget, unit: UnitPreference = "kg"): string | null {
  const top = target.backoff?.topSet;
  if (!top || target.loadKg === null) return null;
  const kg =
    unit !== "kg"
      ? loadNumber(top.loadKg, unit)
      : Number.isInteger(top.loadKg)
        ? String(top.loadKg)
        : String(Number(top.loadKg.toFixed(2)));
  return `backoff from top set ${kg} × ${top.reps}`;
}
