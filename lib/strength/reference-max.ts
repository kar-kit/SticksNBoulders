/**
 * What a percentage is a percentage OF.
 *
 * The ticket is explicit that this is "a table with effective dates, not a
 * number on the profile", and the reason is the failure it prevents: if a
 * prescription said "80%" and the max was a single mutable field, then every
 * historical block would silently re-price itself the moment an e1RM moved.
 * A block written in August has to still explain itself in October.
 *
 * So entries are append-only and each carries the date it takes effect from.
 * Asking for the current max is asking a question with a date in it, and the
 * answer is the newest entry that has already come into effect.
 *
 * Three kinds, but only two are stored:
 *
 *   tested    an actual max attempt, entered by coach or athlete
 *   training  what Ruairi wants percentages calculated against, which is
 *             routinely not the tested max
 *   estimated rolling e1RM from logged work -- derived from stats_rollups at
 *             read time, never written here
 *
 * That last one is load-bearing. `best_e1rm_kg` already lives in the rollups
 * and there is a rebuild script that regenerates it from raw sets. Storing a
 * second copy here would be a second implementation of the same aggregate, and
 * then the rebuild script stops being the repair path -- it would fix one copy
 * and leave the other wrong.
 *
 * Pure. No client, no network, no clock of its own.
 */

/** The kinds a human enters. Deliberately not three -- see above. */
export const STORED_KINDS = ["tested", "training"] as const;
export type StoredKind = (typeof STORED_KINDS)[number];

/** Every kind a percentage can point at, including the derived one. */
export type MaxKind = StoredKind | "estimated";

export interface ReferenceMaxEntry {
  id: string;
  exerciseId: string;
  kind: StoredKind;
  valueKg: number;
  /** ISO date-time this entry applies from. */
  effectiveFrom: string;
  recordedBy: string;
}

export interface ResolvedMax {
  kind: MaxKind;
  valueKg: number;
  /** ISO date-time the number dates from. */
  asOf: string;
  /** Absent for an estimated max, which nobody entered. */
  entryId?: string;
}

const time = (iso: string) => new Date(iso).getTime();

/** An entry with an unparseable date is skipped rather than sorted randomly. */
function isUsable(entry: ReferenceMaxEntry): boolean {
  return Number.isFinite(time(entry.effectiveFrom)) && Number.isFinite(entry.valueKg);
}

/**
 * The newest entry of one kind that has come into effect by `asOf`.
 *
 * Entries dated in the future are deliberately invisible: a coach may set next
 * block's training max in advance, and it must not change this week's
 * percentages before the block starts.
 *
 * Ties break on the later-created row, which is the correction case -- a coach
 * fixing a typo re-enters the same effective date, and the fix must win.
 */
export function currentMax(
  entries: readonly ReferenceMaxEntry[],
  kind: StoredKind,
  asOf: Date,
): ResolvedMax | null {
  const ceiling = asOf.getTime();
  const eligible = entries
    .filter((e) => e.kind === kind && isUsable(e) && time(e.effectiveFrom) <= ceiling)
    .sort((a, b) => time(a.effectiveFrom) - time(b.effectiveFrom));

  const winner = eligible.at(-1);
  if (!winner) return null;
  return {
    kind,
    valueKg: winner.valueKg,
    asOf: winner.effectiveFrom,
    entryId: winner.id,
  };
}

/**
 * The full picture for one exercise: both stored kinds plus the derived one.
 *
 * `estimatedKg` comes from the caller because it lives in stats_rollups, which
 * this module deliberately does not read -- keeping it pure is what makes the
 * date arithmetic exhaustively testable.
 */
export interface ExerciseMaxes {
  tested: ResolvedMax | null;
  training: ResolvedMax | null;
  estimated: ResolvedMax | null;
}

export interface EstimatedInput {
  valueKg: number;
  /** When the set that produced this e1RM was logged. */
  asOf: string;
}

export function resolveMaxes(
  entries: readonly ReferenceMaxEntry[],
  asOf: Date,
  estimated?: EstimatedInput | null,
): ExerciseMaxes {
  return {
    tested: currentMax(entries, "tested", asOf),
    training: currentMax(entries, "training", asOf),
    estimated:
      estimated && Number.isFinite(estimated.valueKg)
        ? { kind: "estimated", valueKg: estimated.valueKg, asOf: estimated.asOf }
        : null,
  };
}

/**
 * Which number a percentage should actually use when nothing says otherwise.
 *
 * Training max first, because that is the whole point of having one: Ruairi
 * sets it precisely so percentages stop tracking a tested single. Tested next,
 * then the estimate, which is the weakest because the athlete never agreed
 * to it -- it is inferred from their work.
 *
 * Order 18 lets a prescription name a kind explicitly. This is only the
 * fallback for one that does not.
 */
export function preferredMax(maxes: ExerciseMaxes): ResolvedMax | null {
  return maxes.training ?? maxes.tested ?? maxes.estimated ?? null;
}

/** "tested" / "e1RM" / "training max", as the Athlete View panel labels them. */
export function kindLabel(kind: MaxKind): string {
  if (kind === "estimated") return "e1RM";
  if (kind === "training") return "training max";
  return "tested";
}

/**
 * Whole kilos read faster in a panel, but a 2.5kg jump must not vanish, so
 * halves survive and nothing else does.
 */
export function formatMaxKg(valueKg: number): string {
  const rounded = Math.round(valueKg * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** "12 Aug", as the blueprint's CURRENT MAXES panel dates each row. */
export function maxDateLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/**
 * One panel row: an exercise, the number a percentage would use, and where
 * that number came from.
 *
 * Exercises with no max at all are dropped by the caller rather than shown
 * blank -- an athlete's library runs to dozens of rows and only a handful ever
 * carry a max.
 */
export interface MaxRow {
  exerciseId: string;
  exerciseName: string;
  max: ResolvedMax;
}

export interface MaxRowInput {
  exerciseId: string;
  exerciseName: string;
  estimated?: EstimatedInput | null;
}

/**
 * Builds the panel's rows: every exercise that has a max, in the order the
 * exercise library gave them.
 *
 * Library order, deliberately, rather than sorting by weight. The blueprint's
 * panel reads Squat, Bench, Deadlift -- competition order -- and the seeded
 * library is in that order, so passing it through reproduces the blueprint
 * without this module needing a concept of a competition lift, which no field
 * in the schema carries. Sorting by weight would put most lifters' deadlift
 * first and quietly diverge from the spec.
 *
 * Exercises with no max are dropped rather than shown blank: a library runs to
 * dozens of rows and only a handful ever carry one.
 */
export function buildMaxRows(
  entries: readonly ReferenceMaxEntry[],
  exercises: readonly MaxRowInput[],
  asOf: Date,
): MaxRow[] {
  const rows: MaxRow[] = [];
  for (const exercise of exercises) {
    const mine = entries.filter((e) => e.exerciseId === exercise.exerciseId);
    const max = preferredMax(resolveMaxes(mine, asOf, exercise.estimated));
    if (!max) continue;
    rows.push({ exerciseId: exercise.exerciseId, exerciseName: exercise.exerciseName, max });
  }
  return rows;
}
