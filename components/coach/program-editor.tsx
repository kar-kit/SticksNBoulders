"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";
import { cn } from "@/lib/cn";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { useSession } from "@/lib/auth/session-context";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import type { Exercise } from "@/lib/exercises/match";
import {
  applyLineOp,
  cellText,
  COLUMNS,
  commitCell,
  dayDateLabel,
  describeBackoffCell,
  describeLoad,
  draftWeeks,
  moveCell,
  suggestDayDate,
  type Column,
} from "@/lib/programming/editor";
import type { DayTree, Prescription, ProgramOpInput, ProgramTree } from "@/lib/programming/program";
import { fetchProgramTree, sendProgramOp } from "@/lib/programming/program-store";

/**
 * The Program Editor. Order 19. The screen that has to beat Excel.
 *
 * Built to the blueprint's block-up-front layout -- week tabs across the top,
 * days down, exercise rows with sets / reps / load / rest / note -- which is
 * an ASSUMPTION still open with Ruairi (question 1). The data underneath does
 * not depend on it: weeks and days are added one at a time, each day carries
 * its own date, and each week its own draft/published status, so week-by-week
 * or session-by-session writing is a different screen over the same rows.
 *
 * Keyboard first: arrows move between cells (sideways only from a cell's
 * edge), Enter commits and moves down, Tab walks the row, Escape puts a cell
 * back, Alt+Up/Down moves a line. A cell saves when it is left. Exercises are
 * typed, never picked from a list; a name the athlete's library lacks is
 * created there.
 *
 * Every write goes to /api/program, which checks the coach still coaches this
 * athlete; nothing here writes Appwrite directly. Edits to a published
 * program are live on save -- see docs/programs.md for why there is no second
 * draft layer yet.
 *
 * Out of scope here, with seams left: duplicate week (Order 20) is one more op
 * plus a button by "+ Week"; backoff rules (21) and video-required (30) are
 * columns after Notes.
 */

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed" }
  | { status: "ready"; tree: ProgramTree };

const COLUMN_LABEL: Record<Column, string> = {
  exercise: "Exercise",
  sets: "Sets",
  reps: "Reps",
  load: "Load",
  rest: "Rest",
  notes: "Note",
  backoff: "Backoff",
  video: "Video",
};

export function ProgramEditor({ programId }: { programId: string }) {
  const { state: session } = useSession();
  const viewerId = session.status === "signed-in" ? session.user.id : null;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [athleteName, setAthleteName] = useState<string | null>(null);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [weekId, setWeekId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const tree = await fetchProgramTree(programId).catch(() => undefined);
    if (tree === undefined) return setLoad({ status: "failed" });
    setLoad(tree ? { status: "ready", tree } : { status: "missing" });
    return tree;
  }, [programId]);

  useEffect(() => {
    void (async () => {
      const tree = await reload();
      if (!tree) return;
      const owner = tree.athleteId ?? tree.coachId;
      // The athlete's library, not the coach's: whatever is prescribed has to
      // be something the athlete can read and log.
      void fetchExerciseLibrary(owner)
        .then(setExercises)
        .catch(() => {});
      if (tree.athleteId && tree.athleteId !== tree.coachId) {
        void fetchAthleteNames([tree.athleteId])
          .then((found) => setAthleteName(found[0]?.name ?? null))
          .catch(() => {});
      }
    })();
  }, [reload]);

  const tree = load.status === "ready" ? load.tree : null;
  const block = tree?.blocks.find((b) => b.id === blockId) ?? tree?.blocks[0] ?? null;
  const week = block?.weeks.find((w) => w.id === weekId) ?? block?.weeks[0] ?? null;
  const names = useMemo(() => new Map(exercises.map((e) => [e.id, e.name])), [exercises]);

  /** A structural write: send it, then read the tree back. */
  const run = async (op: ProgramOpInput): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const { rowId } = await sendProgramOp(op);
      await reload();
      return rowId;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not save.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * A cell write: shown at once, sent, and put back if the server refuses.
   * Reading the whole tree back on every cell would make typing a block feel
   * like RTS, which is the complaint this screen exists to answer.
   */
  const editLine = async (line: Prescription, op: ProgramOpInput): Promise<string | null> => {
    const swap = (to: (l: Prescription) => Prescription) =>
      setLoad((prev) =>
        prev.status !== "ready"
          ? prev
          : {
              status: "ready",
              tree: mapLines(prev.tree, (l) => (l.id === line.id ? to(l) : l)),
            },
      );
    swap((l) => applyLineOp(l, op));
    try {
      await sendProgramOp(op);
      return null;
    } catch (failure) {
      swap(() => line);
      return failure instanceof Error ? failure.message : "That did not save.";
    }
  };

  const createExercise = async (name: string): Promise<Exercise | null> => {
    if (!tree) return null;
    try {
      const { rowId } = await sendProgramOp({ op: "createExercise", programId: tree.id, name });
      const known = exercises.find((e) => e.id === rowId);
      if (known) return known;
      const created: Exercise = {
        id: rowId,
        name: name.trim(),
        normalisedName: name.trim().toLowerCase(),
        isGlobal: false,
        ownerId: tree.athleteId ?? tree.coachId,
      };
      setExercises((prev) => [...prev, created]);
      return created;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add that exercise.");
      return null;
    }
  };

  if (load.status === "loading") return <div className="p-8" aria-busy />;
  if (load.status === "missing" || load.status === "failed" || !tree) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <EmptyState
          title={load.status === "failed" ? "This program did not load" : "No such program"}
          body={
            load.status === "failed"
              ? "Nothing was changed. Reload to try again."
              : "It may have been removed, or it was written by another coach."
          }
          action={<Link href="/coach/programs">Back to Programs</Link>}
        />
      </div>
    );
  }

  // Read-only for anyone but its coach: a second coach in the athlete's circle
  // can read the block but the server will not take their writes.
  const editable = viewerId === tree.coachId;
  const drafts = draftWeeks(tree);
  const weekNumber = (id: string) => tree.blocks.flatMap((b) => b.weeks).findIndex((w) => w.id === id) + 1;

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/coach/programs" className="text-ui text-muted">
            ← Programs
          </Link>
          <InlineText
            label="Program name"
            value={tree.name}
            disabled={!editable}
            className="w-[min(48rem,100%)] text-display font-semibold"
            onCommit={(name) => (name ? run({ op: "updateProgram", programId: tree.id, name }) : null)}
          />
          <p className="m-0 text-ui text-muted">
            {tree.athleteId === tree.coachId ? "Your own training" : (athleteName ?? "Athlete")} ·{" "}
            <span aria-label="Status">
              {tree.status === "published" ? "Published" : tree.status === "archived" ? "Archived" : "Draft"}
            </span>
            {tree.status === "published" && drafts > 0
              ? ` · ${drafts} draft ${drafts === 1 ? "week" : "weeks"} not on their Today yet`
              : ""}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-label uppercase text-muted-2">
            Starts
            <input
              type="date"
              aria-label="Start date"
              disabled={!editable}
              defaultValue={tree.startOn ?? ""}
              key={tree.startOn ?? ""}
              onBlur={(e) => {
                const value = e.target.value || null;
                if (value !== tree.startOn) void run({ op: "updateProgram", programId: tree.id, startOn: value });
              }}
              className="h-9 rounded-control border border-border bg-surface-2 px-2 text-ui text-foreground"
            />
          </label>
          {editable && (tree.status !== "published" || drafts > 0) ? (
            // Draft until published, so a half-written block never reaches
            // Today. One press publishes the program and every week in it.
            <Button disabled={busy} onClick={() => void run({ op: "publishProgram", programId: tree.id })}>
              {tree.status === "published" ? `Publish ${drafts} draft ${drafts === 1 ? "week" : "weeks"}` : "Publish"}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p role="alert" className="m-0 rounded-card border border-danger-line p-3 text-ui">
          {error}
        </p>
      ) : null}

      <nav aria-label="Blocks" className="flex flex-wrap items-center gap-1">
        {tree.blocks.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={b.id === block?.id}
            onClick={() => {
              setBlockId(b.id);
              setWeekId(null);
            }}
            className={cn(
              "h-8 rounded-chip px-3 text-ui",
              b.id === block?.id ? "bg-surface-2 font-semibold text-foreground" : "text-muted",
            )}
          >
            {b.name}
          </button>
        ))}
        {editable ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              const id = await run({ op: "addBlock", programId: tree.id, name: `Block ${tree.blocks.length + 1}` });
              if (id) {
                await run({ op: "addWeek", blockId: id });
                setBlockId(id);
                setWeekId(null);
              }
            }}
          >
            + Block
          </Button>
        ) : null}
      </nav>

      {block ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <div role="tablist" aria-label="Weeks" className="flex flex-wrap items-center gap-1">
              {block.weeks.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="tab"
                  aria-selected={w.id === week?.id}
                  onClick={() => setWeekId(w.id)}
                  className={cn(
                    "h-8 rounded-chip px-3 text-ui",
                    w.id === week?.id
                      ? "bg-surface-2 font-semibold text-foreground shadow-[inset_0_-2px_0_var(--accent-fill)]"
                      : "text-muted",
                  )}
                >
                  {w.label ?? `Week ${weekNumber(w.id)}`}
                  {w.status === "draft" && tree.status === "published" ? " · draft" : ""}
                </button>
              ))}
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    const id = await run({ op: "addWeek", blockId: block.id });
                    if (id) setWeekId(id);
                  }}
                >
                  + Week
                </Button>
              ) : null}
            </div>
            {editable && week ? (
              <ConfirmButton
                label={`Remove ${week.label ?? `week ${weekNumber(week.id)}`}`}
                disabled={busy}
                onConfirm={async () => {
                  await run({ op: "removeWeek", weekId: week.id });
                  setWeekId(null);
                }}
              />
            ) : null}
          </div>

          {week ? (
            <div className="flex flex-col gap-6">
              {week.days.length === 0 ? (
                <p className="m-0 text-body text-muted">No days in this week yet.</p>
              ) : null}
              {week.days.map((day, at) => (
                <DayEditor
                  key={day.id}
                  day={day}
                  index={at}
                  editable={editable}
                  busy={busy}
                  names={names}
                  exercises={exercises}
                  run={run}
                  editLine={editLine}
                  createExercise={createExercise}
                />
              ))}
              {editable ? (
                <div>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run({ op: "addDay", weekId: week.id, scheduledOn: suggestDayDate(tree, week.id) })
                    }
                  >
                    + Day
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="m-0 text-body text-muted">This block has no weeks yet.</p>
          )}
        </>
      ) : (
        <p className="m-0 text-body text-muted">No blocks yet. Add one to start writing.</p>
      )}
    </div>
  );
}

function mapLines(tree: ProgramTree, change: (line: Prescription) => Prescription): ProgramTree {
  return {
    ...tree,
    blocks: tree.blocks.map((b) => ({
      ...b,
      weeks: b.weeks.map((w) => ({
        ...w,
        days: w.days.map((d) => ({ ...d, prescriptions: d.prescriptions.map(change) })),
      })),
    })),
  };
}

/* -------------------------------------------------------------------------
 * One day: its header and its grid
 * ---------------------------------------------------------------------- */

interface DayEditorProps {
  day: DayTree;
  index: number;
  editable: boolean;
  busy: boolean;
  names: ReadonlyMap<string, string>;
  exercises: readonly Exercise[];
  run: (op: ProgramOpInput) => Promise<string | null>;
  editLine: (line: Prescription, op: ProgramOpInput) => Promise<string | null>;
  createExercise: (name: string) => Promise<Exercise | null>;
}

function DayEditor({ day, index, editable, busy, names, exercises, run, editLine, createExercise }: DayEditorProps) {
  const title = day.label ?? `Day ${index + 1}`;
  const grid = useRef<HTMLTableSectionElement>(null);
  const [focusAfter, setFocusAfter] = useState<{ lineId: string; col: Column } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [swapping, setSwapping] = useState<string | null>(null);
  const lines = day.prescriptions;

  // A new line takes the focus once the tree that holds it has arrived.
  useEffect(() => {
    if (!focusAfter) return;
    const row = lines.findIndex((l) => l.id === focusAfter.lineId);
    if (row < 0) return;
    grid.current?.querySelector<HTMLElement>(`[data-cell="${row}-${COLUMNS.indexOf(focusAfter.col)}"]`)?.focus();
    void (async () => {
      await Promise.resolve();
      setFocusAfter(null);
    })();
  }, [focusAfter, lines]);

  const focusCell = (row: number, col: number) =>
    grid.current?.querySelector<HTMLElement>(`[data-cell="${row}-${col}"]`)?.focus();

  const onKey = (event: React.KeyboardEvent<HTMLElement>, row: number, col: number) => {
    const target = event.currentTarget as HTMLInputElement;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      // Moving a line, the one bulk edit a day needs before Order 20's.
      event.preventDefault();
      const to = event.key === "ArrowUp" ? row - 1 : row + 1;
      if (to < 0 || to >= lines.length) return;
      const ids = lines.map((l) => l.id);
      [ids[row], ids[to]] = [ids[to], ids[row]];
      void run({ op: "reorder", level: "prescriptions", parentId: day.id, orderedIds: ids }).then(() =>
        setFocusAfter({ lineId: lines[row].id, col: COLUMNS[col] }),
      );
      return;
    }
    if (event.key === "Escape" && "value" in target) {
      target.value = target.defaultValue;
      target.blur();
      return;
    }
    const caret =
      typeof target.selectionStart === "number" && typeof target.value === "string"
        ? { atStart: target.selectionStart === 0, atEnd: target.selectionEnd === target.value.length }
        : undefined;
    const next = moveCell({ row, col }, event.key, { rows: lines.length, cols: COLUMNS.length }, caret);
    if (event.key === "Enter") {
      event.preventDefault();
      // Leaving the cell is what commits it; Enter on the last row commits in place.
      if (next) focusCell(next.row, next.col);
      else target.blur();
      return;
    }
    if (next) {
      event.preventDefault();
      focusCell(next.row, next.col);
    }
  };

  const commit = async (line: Prescription, column: Exclude<Column, "exercise">, text: string) => {
    const result = commitCell(line, column, text);
    const key = `${line.id}:${column}`;
    if ("unchanged" in result) return;
    if ("error" in result) return setErrors((prev) => ({ ...prev, [key]: result.error }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const failed = await editLine(line, result.op);
    if (failed) setErrors((prev) => ({ ...prev, [key]: failed }));
  };

  const addLine = async (exercise: Exercise) => {
    const id = await run({ op: "addPrescription", dayId: day.id, exerciseId: exercise.id, setCount: 1 });
    if (id) setFocusAfter({ lineId: id, col: "sets" });
  };

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-3">
        <InlineText
          label={`${title} name`}
          value={day.label ?? ""}
          placeholder={`Day ${index + 1}`}
          disabled={!editable}
          className="text-title font-semibold"
          onCommit={(label) => run({ op: "updateDay", dayId: day.id, label })}
        />
        <input
          type="date"
          aria-label={`${title} date`}
          disabled={!editable}
          defaultValue={day.scheduledOn ?? ""}
          key={day.scheduledOn ?? ""}
          onBlur={(e) => {
            const value = e.target.value || null;
            if (value !== day.scheduledOn) void run({ op: "updateDay", dayId: day.id, scheduledOn: value });
          }}
          className="h-9 rounded-control border border-border bg-surface-2 px-2 text-ui text-foreground"
        />
        <span className="text-ui text-muted">{dayDateLabel(day.scheduledOn)}</span>
        <span className="flex-1" />
        {editable ? (
          <ConfirmButton label={`Remove ${title}`} disabled={busy} onConfirm={() => run({ op: "removeDay", dayId: day.id })} />
        ) : null}
      </header>

      <table className="w-full border-collapse text-ui">
        <thead>
          <tr className="text-left font-mono text-label uppercase text-muted-2">
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="px-1 pb-1 font-normal">
                {COLUMN_LABEL[column]}
              </th>
            ))}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody ref={grid}>
          {lines.map((line, row) => {
            const name = names.get(line.exerciseId) ?? "Exercise";
            const loadKind = describeLoad(line.load);
            return (
              <tr key={line.id} aria-label={`${title} line ${row + 1}: ${name}`} className="align-top">
                <td className="w-64 px-1 py-0.5">
                  {swapping === line.id ? (
                    <ExerciseTypeahead
                      exercises={exercises}
                      label={`Exercise for line ${row + 1}`}
                      placeholder={name}
                      autoFocus
                      onSelect={async (exercise) => {
                        setSwapping(null);
                        if (exercise.id !== line.exerciseId) {
                          await editLine(line, {
                            op: "updatePrescription",
                            prescriptionId: line.id,
                            exerciseId: exercise.id,
                          });
                        }
                      }}
                      onCreate={async (typed) => {
                        setSwapping(null);
                        const created = await createExercise(typed);
                        if (created) {
                          await editLine(line, {
                            op: "updatePrescription",
                            prescriptionId: line.id,
                            exerciseId: created.id,
                          });
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      data-cell={`${row}-0`}
                      disabled={!editable}
                      onClick={() => setSwapping(line.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "F2") {
                          e.preventDefault();
                          setSwapping(line.id);
                          return;
                        }
                        onKey(e, row, 0);
                      }}
                      className="h-9 w-full truncate rounded-control px-2 text-left font-semibold focus:outline-2 focus:outline-accent-line"
                    >
                      {name}
                    </button>
                  )}
                </td>
                {COLUMNS.slice(1).map((column, offset) => {
                  const col = offset + 1;
                  const key = `${line.id}:${column}`;
                  const text = cellText(line, column as Exclude<Column, "exercise">);
                  return (
                    <td
                      key={column}
                      className={cn(
                        "px-1 py-0.5",
                        column === "sets" || column === "reps" || column === "rest" ? "w-20" : "",
                        column === "load" ? "w-56" : "",
                        column === "backoff" ? "w-44" : "",
                        column === "video" ? "w-16" : "",
                      )}
                    >
                      {column === "video" ? (
                        // A toggle, not a typed cell: Space flips it; arrows and
                        // Enter walk the grid like every other cell.
                        <input
                          type="checkbox"
                          data-cell={`${row}-${col}`}
                          aria-label={`Video required, line ${row + 1}`}
                          disabled={!editable}
                          checked={line.videoRequired}
                          onChange={(e) => void commit(line, "video", e.target.checked ? "Yes" : "No")}
                          onKeyDown={(e) => onKey(e, row, col)}
                          className="mx-3 mt-2.5 size-4 accent-accent-fill focus:outline-2 focus:outline-accent-line"
                        />
                      ) : (
                      <input
                        data-cell={`${row}-${col}`}
                        aria-label={`${COLUMN_LABEL[column]}, line ${row + 1}`}
                        aria-invalid={errors[key] ? true : undefined}
                        disabled={!editable}
                        defaultValue={text}
                        key={text}
                        onKeyDown={(e) => onKey(e, row, col)}
                        onBlur={(e) => void commit(line, column as Exclude<Column, "exercise">, e.target.value)}
                        className={cn(
                          "h-9 w-full rounded-control border bg-surface-2 px-2 text-foreground tabular-nums focus:outline-none",
                          errors[key] ? "border-danger-line" : "border-border focus:border-accent-line",
                        )}
                      />
                      )}
                      {column === "load" ? (
                        // What the typing landed as. The bare-8 and 75%% cases
                        // are caught here or not at all.
                        <span className="block px-1 pt-0.5 text-caption text-muted" data-kind={loadKind.kind ?? "none"}>
                          {loadKind.label}
                        </span>
                      ) : null}
                      {column === "backoff" && line.backoff ? (
                        // Order 21: what the rule will do with today's top set.
                        <span className="block px-1 pt-0.5 text-caption text-muted" data-kind="backoff">
                          {describeBackoffCell(line.backoff)}
                        </span>
                      ) : null}
                      {errors[key] ? (
                        <span role="alert" className="block px-1 pt-0.5 text-caption text-danger-line">
                          {errors[key]}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
                <td className="w-10 px-1 py-0.5 text-right">
                  {editable ? (
                    <button
                      type="button"
                      aria-label={`Remove line ${row + 1}`}
                      onClick={() => void run({ op: "removePrescription", prescriptionId: line.id })}
                      className="h-9 rounded-control px-2 text-muted hover:text-foreground"
                    >
                      ×
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editable ? (
        <div className="max-w-sm">
          <ExerciseTypeahead
            exercises={exercises}
            label={`Add exercise to ${title}`}
            placeholder="Type an exercise to add a line"
            clearOnSelect
            onSelect={(exercise) => void addLine(exercise)}
            onCreate={async (typed) => {
              const created = await createExercise(typed);
              if (created) await addLine(created);
            }}
          />
        </div>
      ) : null}

      <InlineText
        label={`${title} note`}
        value={day.notes ?? ""}
        placeholder="A note for the athlete, shown under Today's card"
        disabled={!editable}
        className="text-ui"
        onCommit={(notes) => run({ op: "updateDay", dayId: day.id, notes })}
      />
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Small pieces
 * ---------------------------------------------------------------------- */

/** A text that saves when left. Escape puts it back. */
function InlineText({
  label,
  value,
  placeholder,
  disabled,
  className,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onCommit: (value: string) => unknown;
}) {
  return (
    <input
      aria-label={label}
      defaultValue={value}
      key={value}
      placeholder={placeholder}
      disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next !== value.trim()) void onCommit(next);
      }}
      className={cn(
        "min-w-0 rounded-control border border-transparent bg-transparent px-1 text-foreground",
        "placeholder:text-muted-2 hover:border-border focus:border-accent-line focus:outline-none",
        className,
      )}
    />
  );
}

/** Removal asks once, inline, rather than in a dialog that steals the keyboard. */
function ConfirmButton({
  label,
  disabled,
  onConfirm,
}: {
  label: string;
  disabled?: boolean;
  onConfirm: () => unknown;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-ui text-muted">Logged sessions keep what was done.</span>
      <Button
        variant="danger"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          void onConfirm();
        }}
      >
        Confirm {label.toLowerCase()}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Keep
      </Button>
    </span>
  );
}
