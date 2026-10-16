import { parsePrescription, resolvePrescription, type PrescriptionKind } from "./prescription";
import { describeBackoff, formatBackoff, parseBackoff } from "./backoff";
import type { Prescription, ProgramOpInput, ProgramTree, WeekTree } from "./program";
import { basisMaxesFor, referenceOf } from "./session-plan";
import {
  formatMaxKg,
  maxDateLabel,
  resolveMaxes,
  type EstimatedInput,
  type MaxKind,
  type ReferenceMaxEntry,
  type StoredKind,
} from "@/lib/strength/reference-max";
import { rankExercises, type Exercise } from "@/lib/exercises/match";

/**
 * The Program Editor's rules, as pure functions. Order 19.
 *
 * The grid is the screen that has to beat Excel, so the behaviour that decides
 * whether it does -- what a typed cell turns into, where an arrow key goes,
 * which date a new day lands on -- lives here, where it is tested, rather than
 * in event handlers where it is only ever discovered mid-block.
 *
 * Pure. No client, no network, no clock of its own.
 */

/**
 * The grid's editable columns, left to right. Backoff (Order 21) is a typed
 * rule; `video` (Order 30) is a toggle, not a typed cell.
 */
export const COLUMNS = ["exercise", "sets", "reps", "load", "rest", "notes", "backoff", "video"] as const;
export type Column = (typeof COLUMNS)[number];

/* -------------------------------------------------------------------------
 * The load cell's indicator
 * ---------------------------------------------------------------------- */

const BASIS_WORDS: Record<MaxKind, string> = {
  training: "training max",
  tested: "tested max",
  estimated: "e1RM",
};

const trim = (value: number) => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))));

/** What an empty load cell says: what it takes, not that something is wrong. */
export const EMPTY_LOAD = "No load yet · type 75%, @8 or 142.5";

/**
 * What the coach's typing landed as, in words, shown beside the load cell.
 *
 * This is the indicator Order 18 owes the coach: parsing never fails, so a
 * mistyped `75%%` or a bare `8` meant as RPE becomes something else silently
 * unless the screen says so. The kind leads, because the kind is the mistake.
 *
 * `reference` is the name of the lift a percentage on this line is OF, when it
 * is not the line's own (docs/reference-lift.md). It shows where it matters:
 * on a percentage, and on an empty cell -- a new row that inherited it, about
 * to be typed into. Under `@8` or `142.5` it is kept but means nothing.
 */
export function describeLoad(
  text: string | null,
  reference?: string | null,
): { kind: PrescriptionKind | null; label: string } {
  const spec = text ? parsePrescription(text) : null;
  // An empty cell says what it takes. The bare "No load" read as a fault on
  // a row that simply had not been typed yet (Joey's screenshot, Oct 2026).
  if (!spec) return { kind: null, label: reference ? `No load · a percentage here is of ${reference}` : EMPTY_LOAD };
  const of = (percent: number, basis: MaxKind) =>
    reference ? `${trim(percent)}% of ${reference} (${BASIS_WORDS[basis]})` : `${trim(percent)}% of ${BASIS_WORDS[basis]}`;
  switch (spec.kind) {
    case "fixed":
      return { kind: "fixed", label: `Fixed · ${trim(spec.loadKg)} kg` };
    case "percent":
      return { kind: "percent", label: `Percent · ${of(spec.percent, spec.basis)}` };
    case "rpe":
      return { kind: "rpe", label: `RPE ${trim(spec.rpe)} · athlete picks the weight` };
    case "capped":
      return {
        kind: "capped",
        label: `Capped · ${of(spec.percent, spec.basis)}, stop at RPE ${trim(spec.rpe)}`,
      };
    case "freeform":
      return { kind: "freeform", label: "Freeform · shown as written" };
  }
}

/** The maxes the editor reads for the athlete: the same two sources the logger uses. */
export interface EditorMaxes {
  entries: readonly ReferenceMaxEntry[];
  estimated: ReadonlyMap<string, EstimatedInput>;
}

/**
 * What the editor knows about the athlete's maxes: read, still reading, could
 * not read, or a template with nobody's maxes to read. Unknown is not missing,
 * so only `EditorMaxes` ever produces a warning.
 */
export type MaxesRead = EditorMaxes | "loading" | "failed" | "template";

/**
 * The second line under a load cell: what the athlete will actually get.
 *
 *   resolved  "→ 142.5 kg · Squat training max 190, set 12 Sep"
 *   missing   "No Squat training max for Joey · they see "75%"", with the
 *             max to add when the coach can add it here
 *   quiet     a plain statement: maxes still loading or unread, a template
 */
export interface LoadPreview {
  tone: "resolved" | "missing" | "quiet";
  text: string;
  /** The max that would fix a missing one: typed into the editor, written through /api/reference-max. */
  addMax?: { exerciseId: string; name: string; kind: StoredKind };
}

export interface PreviewContext {
  maxes: MaxesRead;
  nameOf: (exerciseId: string) => string | null | undefined;
  /** Null when the coach is programming themselves. */
  athleteName: string | null;
  /** The date the max is read at: see `previewDate`. */
  asOf: Date;
}

/**
 * The instant a day's percentages are priced at in the editor: the start of
 * the day's own date, or now when that is already past (or the day has none).
 *
 * The phone resolves at render time, so a past day the athlete has not opened
 * yet will be priced off today's max, and a future day off whatever is in
 * effect then -- which is what lets a coach set next block's training max in
 * advance and see week 5 price off it. [Inference] docs/program-layout.md.
 * The end of the day rather than its start would show a max dated that
 * afternoon; the start matches what the athlete opening it first thing gets.
 */
export function previewDate(scheduledOn: string | null, now: Date): Date {
  if (!scheduledOn) return now;
  const day = new Date(`${scheduledOn}T00:00:00`);
  return Number.isNaN(day.getTime()) || day < now ? now : day;
}

/**
 * The kilos a percentage resolves to for this athlete, and from which max --
 * or exactly why it resolves to none, and what would fix it.
 *
 * The same resolver as the athlete's phone (`basisMaxesFor`, then
 * `resolvePrescription`, rounded down by `roundToLoadable`), with no session
 * max: the editor cannot know today's top set, and the stored max is what the
 * session opens with. Nothing here does arithmetic of its own; the date beside
 * the max is read back from `resolveMaxes`, the function the resolver's
 * numbers came from.
 *
 * Null where the kind line under the cell already says everything: a fixed
 * load, an RPE, freeform words, an empty cell (`describeLoad` covers those).
 */
export function loadPreview(line: Prescription, context: PreviewContext): LoadPreview | null {
  const spec = line.load ? parsePrescription(line.load) : null;
  // An RPE row gets no kilos: the phone shows "RPE 8" and lets the athlete
  // pick, so an editor estimate would be a number the athlete never sees, off
  // an [Unverified] chart. Its kind line already says "athlete picks".
  if (!spec || spec.kind === "fixed" || spec.kind === "freeform" || spec.kind === "rpe") return null;

  const whose = context.athleteName ? `${context.athleteName}'s` : "the";
  if (context.maxes === "template") return { tone: "quiet", text: "Template · kilos resolve per athlete" };
  if (context.maxes === "loading") return { tone: "quiet", text: `Kilos appear once ${whose} maxes load` };
  if (context.maxes === "failed") return { tone: "quiet", text: `Could not read ${whose} maxes · kilos unknown` };

  const { entries, estimated } = context.maxes;
  const reference = referenceOf(line, spec);
  const lift = reference ?? line.exerciseId;
  const name = context.nameOf(lift) || "this lift";
  const basis = basisMaxesFor(lift, entries, estimated, context.asOf);
  const resolved = resolvePrescription(spec, { ...basis, session: null }, reference ? { name } : undefined);
  const cap = spec.kind === "capped" ? `, stop at RPE ${trim(spec.rpe)}` : "";

  if (!resolved.unresolved && resolved.loadKg !== null && resolved.basisUsed && resolved.basisKg !== null) {
    // `session` cannot be chosen: no session max was passed.
    const used = resolved.basisUsed === "session" ? spec.basis : resolved.basisUsed;
    const own = entries.filter((entry) => entry.exerciseId === lift);
    const from = resolveMaxes(own, context.asOf, estimated.get(lift) ?? null)[used];
    const when = from ? maxDateLabel(from.asOf) : "";
    // An e1RM was not set by anyone: it dates from the set that produced it.
    const dated = when ? `, ${used === "estimated" ? "from" : "set"} ${when}` : "";
    return {
      tone: "resolved",
      text: `→ ${trim(resolved.loadKg)} kg${cap} · ${name} ${BASIS_WORDS[used]} ${formatMaxKg(resolved.basisKg)}${dated}`,
    };
  }

  // An e1RM comes from logged sets; there is nothing to type in for it.
  if (spec.basis === "estimated") {
    return {
      tone: "missing",
      text: `No ${name} e1RM yet: nothing logged with an RPE · drop "of e1rm" to use the training max`,
    };
  }
  const kind: StoredKind = spec.basis;
  const addMax = { exerciseId: lift, name, kind };
  // A max set in advance is not missing, it is early: say when it starts.
  const ahead = entries
    .filter((e) => e.exerciseId === lift && e.kind === kind && new Date(e.effectiveFrom).getTime() > context.asOf.getTime())
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  if (ahead) {
    return {
      tone: "missing",
      text: `${name} ${BASIS_WORDS[kind]} ${formatMaxKg(ahead.valueKg)} starts ${maxDateLabel(ahead.effectiveFrom)} · nothing in effect yet`,
      addMax,
    };
  }
  const who = context.athleteName ? ` for ${context.athleteName}` : "";
  return { tone: "missing", text: `No ${name} ${BASIS_WORDS[kind]}${who} · they see "${resolved.display}"`, addMax };
}

/**
 * The warning alone: `loadPreview`'s missing line, or null. Null while the
 * maxes are unknown (`maxes: null`), on anything that resolves, and on
 * anything that is not a percentage.
 */
export function unresolvedWarning(
  line: Prescription,
  context: Omit<PreviewContext, "maxes"> & { maxes: EditorMaxes | null },
): string | null {
  if (!context.maxes) return null;
  const preview = loadPreview(line, { ...context, maxes: context.maxes });
  return preview?.tone === "missing" ? preview.text : null;
}

/**
 * The reference a new line on this exercise starts with: the one on the last
 * line of the same exercise in this program, in program order, or null.
 *
 * This is "typed once per variation per program" (docs/reference-lift.md §1):
 * the coach says `of bench` on the first Tempo Bench line and every Tempo
 * Bench line added after it inherits it, including through duplicated weeks,
 * which carry the column. `of own` on the latest line stops the inheritance.
 * [Inference] Program order rather than edit time: the tree carries no
 * per-cell history, and coaches write a block forwards.
 */
export function rememberedReference(tree: ProgramTree, exerciseId: string): string | null {
  let last: Prescription | null = null;
  for (const block of tree.blocks)
    for (const week of block.weeks)
      for (const day of week.days)
        for (const line of day.prescriptions) if (line.exerciseId === exerciseId) last = line;
  const reference = last?.referenceExerciseId ?? null;
  return reference && reference !== exerciseId ? reference : null;
}

/* -------------------------------------------------------------------------
 * The load cell's `of <lift>` clause
 * ---------------------------------------------------------------------- */

/** The words `of tested` / `of training max` / `of e1rm` already mean: a KIND, never a lift. */
const BASIS_WORD = /^(?:tested|training(?:\s+max)?|e1rm|estimated)$/i;
/** ` of <words>`, up to the next ` of`, an RPE, or the end of the cell. */
const OF_CLAUSE = /\s*\bof\s+(.+?)(?=\s+of\s|\s*@|\s+rpe\s*\d|\s*$)/gi;

/**
 * Splits a typed `of <lift>` out of a load cell: `70% of bench` is load `70%`
 * on the bench's max. The grammar is untouched -- the stored load stays `70%`,
 * so the athlete's parser, the copy rules and every existing cell are what
 * they were -- and the lift goes to `referenceExerciseId`.
 *
 *   70% of bench          -> 70%, bench
 *   70% of bench @8       -> 70% @8, bench
 *   70% of bench of tested-> 70% of tested, bench
 *   70% of tested         -> untouched: a kind, not a lift
 *   70% of own            -> 70%, null (back to the line's own max)
 *   75% of nonsense       -> untouched, so it lands as freeform as it does today
 *
 * The lift is matched against the athlete's library with the typeahead's own
 * ranking, best match first. Returns `reference: undefined` when the cell
 * names no lift, which leaves the line's reference alone.
 */
export function splitReference(
  text: string,
  library: readonly Exercise[],
): { load: string; reference?: string | null } {
  if (!text.includes("%")) return { load: text };
  for (const match of text.matchAll(OF_CLAUSE)) {
    const words = match[1].trim();
    if (BASIS_WORD.test(words)) continue;
    const load = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
    const spec = parsePrescription(load);
    // Only a percentage can be OF something. Anything else stays as typed.
    if (spec?.kind !== "percent" && spec?.kind !== "capped") return { load: text };
    if (/^own$/i.test(words)) return { load, reference: null };
    const best = rankExercises(words, library, 1)[0];
    return best ? { load, reference: best.exercise.id } : { load: text };
  }
  return { load: text };
}

/* -------------------------------------------------------------------------
 * Cells: text in, fields out
 * ---------------------------------------------------------------------- */

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

export function parseSetsCell(text: string): Parsed<number> {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < 1 || value > 50) return { ok: false, reason: "Sets is a whole number, 1 to 50" };
  return { ok: true, value };
}

/** `5`, `8-10` or `8–10`, or empty for a line whose load cell says it all. */
export function parseRepsCell(text: string): Parsed<{ reps: number | null; repMax: number | null }> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: { reps: null, repMax: null } };
  const match = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/.exec(trimmed);
  const reps = match ? Number(match[1]) : NaN;
  const top = match?.[2] ? Number(match[2]) : null;
  if (!match || reps < 1 || reps > 100 || (top !== null && (top > 100 || top < reps))) {
    return { ok: false, reason: "Reps is a number like 5, or a range like 8-10" };
  }
  return { ok: true, value: { reps, repMax: top === reps ? null : top } };
}

export function formatRepsCell(reps: number | null, repMax: number | null): string {
  if (reps === null) return "";
  return repMax !== null && repMax !== reps ? `${reps}-${repMax}` : String(reps);
}

/** `90` (seconds), `90s`, `3m`, `2:30`, or empty for no rest prescribed. */
export function parseRestCell(text: string): Parsed<number | null> {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return { ok: true, value: null };
  let seconds: number | null = null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  const minutes = /^(\d{1,2}(?:\.\d+)?)\s*m(?:in)?$/.exec(trimmed);
  const plain = /^(\d{1,4})\s*s?$/.exec(trimmed);
  if (clock) seconds = Number(clock[1]) * 60 + Number(clock[2]);
  else if (minutes) seconds = Math.round(Number(minutes[1]) * 60);
  else if (plain) seconds = Number(plain[1]);
  if (seconds === null || seconds > 3600) return { ok: false, reason: "Rest is like 90, 3m or 2:30 -- up to an hour" };
  return { ok: true, value: seconds };
}

export function formatRestCell(seconds: number | null): string {
  if (seconds === null) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------
 * Shorthand: `5x3 @8` fills sets, reps and load at once
 * ---------------------------------------------------------------------- */

/** Sets, reps and (if typed) a load, from `5x3 @8`. */
export interface Shorthand {
  setCount: number;
  reps: number | null;
  repMax: number | null;
  /** Undefined when nothing followed the reps: see `shorthandOp`'s `whole`. */
  load?: string;
}

/**
 * `<sets> x <reps> [load]`, the way coaches write a line on paper.
 *
 *   5x3            5 sets of 3
 *   5 x 3 @8       and an RPE
 *   3×5 75%        a percentage (× as well as x)
 *   3x8-10 @7      a rep range
 *   4x4 70% of bench   a reference lift, split out later by splitReference
 *   3x @8          sets only: the load cell says it all
 *
 * The load starts after a space, or straight after the reps with `@`:
 * `5x3@8` is shorthand, `3x75%` is not (75 reps of "%"?), so it is left to
 * the load grammar, which keeps it as the coach's words.
 */
const SHORTHAND = /^(\d{1,2})\s*[x×]\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?(?:(?:\s+|(?=@))(\S.*?))?\s*$/i;

/**
 * Null when the text is not shorthand at all -- a plain `5` in the sets cell,
 * `75%` in the load cell -- so every cell keeps its own grammar. Shorthand
 * whose numbers are out of range is refused with the cell's own words, never
 * half-applied.
 */
export function parseShorthand(text: string): Parsed<Shorthand> | null {
  const match = SHORTHAND.exec(text.trim());
  if (!match) return null;
  const sets = parseSetsCell(match[1]);
  if (!sets.ok) return sets;
  const reps = parseRepsCell(match[2] ?? "");
  if (!reps.ok) return reps;
  return {
    ok: true,
    value: { setCount: sets.value, ...reps.value, ...(match[3] ? { load: match[3].trim() } : {}) },
  };
}

/**
 * The one `updatePrescription` a shorthand becomes: only the fields it
 * changes, as `commitCell` sends only the edited field.
 *
 * `whole` is the progression cell, which holds the line's sets, reps and load
 * together: there, leaving the load off clears it. In the week grid's sets or
 * reps cell, `5x3` says nothing about the load, so the load is left alone.
 */
export function shorthandOp(
  line: Prescription,
  shorthand: Shorthand,
  library: readonly Exercise[],
  options: { whole?: boolean } = {},
): { op: ProgramOpInput } | { unchanged: true } | { error: string } {
  const op: Extract<ProgramOpInput, { op: "updatePrescription" }> = { op: "updatePrescription", prescriptionId: line.id };
  if (shorthand.setCount !== line.setCount) op.setCount = shorthand.setCount;
  if (shorthand.reps !== line.reps || shorthand.repMax !== line.repMax) {
    op.reps = shorthand.reps;
    op.repMax = shorthand.repMax;
  }
  const typedLoad = shorthand.load ?? (options.whole ? "" : undefined);
  if (typedLoad !== undefined) {
    const { load, reference } = splitReference(typedLoad, library);
    if (load.length > 120) return { error: "Load is 120 characters at most" };
    if (load.trim() !== (line.load ?? "").trim()) op.load = load;
    if (reference !== undefined && reference !== (line.referenceExerciseId ?? null)) op.referenceExerciseId = reference;
  }
  return Object.keys(op).length > 2 ? { op } : { unchanged: true };
}

/**
 * A line as one progression cell: `3x5 75%`, `1x5 @8`, `3x8-10`, `3x @8`.
 * What `parseShorthand` reads back, so an untouched cell round-trips.
 */
export function progressionText(line: Pick<Prescription, "setCount" | "reps" | "repMax" | "load">): string {
  const load = line.load?.trim();
  return `${line.setCount}x${formatRepsCell(line.reps, line.repMax)}${load ? ` ${load}` : ""}`;
}

/**
 * A committed progression cell: shorthand fills all three; anything else is
 * the load alone (`77.5%` across a row of weeks is the common edit), and an
 * emptied cell is put back rather than read as "remove this line" -- removal
 * stays in the week view, behind its ×.
 */
export function commitProgression(
  line: Prescription,
  text: string,
  library: readonly Exercise[] = [],
): { op: ProgramOpInput } | { unchanged: true } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed || trimmed === progressionText(line)) return { unchanged: true };
  const shorthand = parseShorthand(trimmed);
  if (shorthand && !shorthand.ok) return { error: shorthand.reason };
  if (shorthand) return shorthandOp(line, shorthand.value, library, { whole: true });
  return shorthandOp(line, { setCount: line.setCount, reps: line.reps, repMax: line.repMax, load: trimmed }, library);
}

/** A cell's text as the grid shows it. The exercise column is named by the caller. */
export function cellText(line: Prescription, column: Exclude<Column, "exercise">): string {
  switch (column) {
    case "sets":
      return String(line.setCount);
    case "reps":
      return formatRepsCell(line.reps, line.repMax);
    case "load":
      return line.load ?? "";
    case "rest":
      return formatRestCell(line.restSeconds);
    case "notes":
      return line.notes ?? "";
    case "backoff":
      return line.backoff ?? "";
    case "video":
      return line.videoRequired ? "Yes" : "No";
  }
}

/**
 * What the backoff cell's rule means, beside it: "3 sets at 90% of today's
 * top set". The same job describeLoad does for the load cell.
 */
export function describeBackoffCell(text: string | null | undefined): string {
  const parsed = parseBackoff(text);
  return parsed.ok ? describeBackoff(parsed.rule) : parsed.reason;
}

/**
 * The write a committed cell becomes: an op, nothing (unchanged), or the
 * reason it cannot be saved -- shown on the cell, never a toast.
 *
 * Only the edited field is sent. Two coaches cannot edit the same program, but
 * one coach in two tabs can, and a whole-row write would put back whatever the
 * other tab changed.
 */
export function commitCell(
  line: Prescription,
  column: Exclude<Column, "exercise">,
  text: string,
  /** The athlete's library, for a load cell naming another lift (`70% of bench`). */
  library: readonly Exercise[] = [],
): { op: ProgramOpInput } | { unchanged: true } | { error: string } {
  if (text.trim() === cellText(line, column).trim()) return { unchanged: true };
  const base = { op: "updatePrescription" as const, prescriptionId: line.id };
  // `5x3 @8` typed into sets, reps or load fills all three: whichever cell
  // the coach happens to be in, the line on paper is what they type.
  if (column === "sets" || column === "reps" || column === "load") {
    const shorthand = parseShorthand(text);
    if (shorthand && !shorthand.ok) return { error: shorthand.reason };
    if (shorthand) return shorthandOp(line, shorthand.value, library);
  }
  switch (column) {
    case "sets": {
      const parsed = parseSetsCell(text);
      return parsed.ok ? { op: { ...base, setCount: parsed.value } } : { error: parsed.reason };
    }
    case "reps": {
      const parsed = parseRepsCell(text);
      return parsed.ok ? { op: { ...base, ...parsed.value } } : { error: parsed.reason };
    }
    case "load": {
      // Anything goes: freeform is the escape hatch, and the indicator says
      // what it landed as. A named lift comes off the text into its column.
      const { load, reference } = splitReference(text, library);
      if (load.length > 120) return { error: "Load is 120 characters at most" };
      if (reference === undefined) return { op: { ...base, load } };
      const loadChanged = load.trim() !== (line.load ?? "").trim();
      const referenceChanged = reference !== (line.referenceExerciseId ?? null);
      if (!loadChanged && !referenceChanged) return { unchanged: true };
      return {
        op: {
          ...base,
          ...(loadChanged ? { load } : {}),
          ...(referenceChanged ? { referenceExerciseId: reference } : {}),
        },
      };
    }
    case "rest": {
      const parsed = parseRestCell(text);
      return parsed.ok ? { op: { ...base, restSeconds: parsed.value } } : { error: parsed.reason };
    }
    case "notes":
      return text.length > 500 ? { error: "A note is 500 characters at most" } : { op: { ...base, notes: text } };
    case "backoff": {
      // No freeform fallback: a rule that does not parse cannot be executed,
      // so it is refused on the cell. Saved in its canonical spelling.
      const parsed = parseBackoff(text);
      if (!parsed.ok) return { error: parsed.reason };
      const backoff = parsed.rule ? formatBackoff(parsed.rule) : null;
      return backoff === (line.backoff ?? null) ? { unchanged: true } : { op: { ...base, backoff } };
    }
    case "video":
      return { op: { ...base, videoRequired: /^(yes|y|true|1)$/i.test(text.trim()) } };
  }
}

/** A line's fields after an op, so the grid can show the save before the server answers. */
export function applyLineOp(line: Prescription, op: ProgramOpInput): Prescription {
  if (op.op !== "updatePrescription" || op.prescriptionId !== line.id) return line;
  const load = op.load === undefined ? line.load : op.load?.trim() || null;
  return {
    ...line,
    exerciseId: op.exerciseId ?? line.exerciseId,
    setCount: op.setCount ?? line.setCount,
    reps: op.reps === undefined ? line.reps : op.reps,
    repMax: op.repMax === undefined ? line.repMax : op.repMax,
    load,
    loadKind: op.load === undefined ? line.loadKind : load ? (parsePrescription(load)?.kind ?? null) : null,
    restSeconds: op.restSeconds === undefined ? line.restSeconds : op.restSeconds,
    notes: op.notes === undefined ? line.notes : op.notes?.trim() || null,
    backoff: op.backoff === undefined ? line.backoff : op.backoff?.trim() || null,
    videoRequired: op.videoRequired ?? line.videoRequired ?? false,
    referenceExerciseId:
      op.referenceExerciseId === undefined ? (line.referenceExerciseId ?? null) : op.referenceExerciseId,
  };
}

/* -------------------------------------------------------------------------
 * Keyboard movement
 * ---------------------------------------------------------------------- */

export interface CellAt {
  row: number;
  col: number;
}

/**
 * Where a key sends the focus, or null to leave the key to the input.
 *
 * Up and down always move rows -- nothing in a single-line cell uses them.
 * Left and right only leave a cell from its edge, so a coach can still move
 * the caret inside `75% @8` to fix a digit. Enter commits and moves down, as
 * in a spreadsheet. Tab is left to the browser, which already walks the cells
 * in order.
 */
export function moveCell(
  at: CellAt,
  key: string,
  size: { rows: number; cols: number },
  caret: { atStart: boolean; atEnd: boolean } = { atStart: true, atEnd: true },
): CellAt | null {
  const clampRow = (row: number) => Math.max(0, Math.min(size.rows - 1, row));
  switch (key) {
    case "ArrowUp":
      return at.row > 0 ? { row: at.row - 1, col: at.col } : null;
    case "ArrowDown":
    case "Enter":
      return at.row < size.rows - 1 ? { row: clampRow(at.row + 1), col: at.col } : null;
    case "ArrowLeft":
      return caret.atStart && at.col > 0 ? { row: at.row, col: at.col - 1 } : null;
    case "ArrowRight":
      return caret.atEnd && at.col < size.cols - 1 ? { row: at.row, col: at.col + 1 } : null;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------
 * Calendar
 * ---------------------------------------------------------------------- */

/** "Mon 6 Oct", read as the athlete's calendar day rather than an instant. */
export function dayDateLabel(day: string | null): string {
  if (!day) return "No date";
  const date = new Date(`${day}T12:00:00Z`);
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** How many weeks are still drafts -- what the Publish button counts. */
export function draftWeeks(tree: ProgramTree): number {
  return tree.blocks.reduce((n, block) => n + block.weeks.filter((week) => week.status === "draft").length, 0);
}

export type WeekState = "draft" | "live" | "logged";

/**
 * What the outline shows beside a week. Logged beats live: once the athlete
 * has started a session from one of its days, that is the thing the coach
 * most needs to know before editing it. Live means the athlete can see it --
 * the week AND its program published, the same rule as `isLiveDay`. `logged`
 * is null when the sessions could not be read; the week then shows as draft
 * or live, never as logged by guess.
 */
export function weekState(
  tree: Pick<ProgramTree, "status">,
  week: Pick<WeekTree, "status" | "days">,
  logged: ReadonlySet<string> | null,
): WeekState {
  if (logged && week.days.some((d) => logged.has(d.id))) return "logged";
  return week.status === "published" && tree.status === "published" ? "live" : "draft";
}
