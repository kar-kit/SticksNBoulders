"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Menu } from "@/components/ui/menu";
import { Tabs } from "@/components/ui/tabs";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";
import { CopyProgram } from "@/components/coach/copy-program";
import { ConfirmStrip, InlineText } from "@/components/coach/program-editor-parts";
import { ProgramCalendar } from "@/components/coach/program-calendar";
import { ProgramOutline } from "@/components/coach/program-outline";
import { cn } from "@/lib/cn";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { useSession } from "@/lib/auth/session-context";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { fetchEstimatedMaxes, fetchReferenceMaxes } from "@/lib/strength/reference-max-store";
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
  rememberedReference,
  unresolvedWarning,
  weekState,
  type Column,
  type EditorMaxes,
} from "@/lib/programming/editor";
import {
  newDayDate,
  placeDay,
  programAnchor,
  rangeLabel,
  redatePlan,
  scheduledOnFor,
  weekIndexOf,
  weekRange,
  WEEKDAYS,
} from "@/lib/programming/calendar";
import { copyWeekPlan } from "@/lib/programming/copy";
import type { BlockTree, DayTree, Prescription, ProgramOpInput, ProgramTree } from "@/lib/programming/program";
import type { EditorLanding, EditorView } from "@/lib/coach/adjust-program";
import { fetchLoggedDayIds, fetchProgramTree, sendProgramOp } from "@/lib/programming/program-store";

/**
 * The Program Editor. Order 19. The screen that has to beat Excel.
 *
 * Three columns: the coach's athlete rail (the shell's), the program outline
 * (blocks, their dates, their weeks and where each stands), and the week on
 * screen. One primary action at a time: the week's Publish. Everything else
 * sits in a ⋯ beside the thing it acts on -- the program, a block, a week, a
 * day -- the TrueCoach / TrainHeroic shape.
 *
 * Dates come from the program's start date. A week is a Monday-to-Sunday row
 * counted from it and a day is a weekday chip; the stored `scheduled_on` is
 * computed (lib/programming/calendar.ts). Moving the start date moves every
 * day that sits in its week, except a day an athlete has logged from.
 *
 * Writing shape (Ruairi, question 1) is "a mix depending on the athlete", so
 * nothing here forces block-up-front: "+ Week" repeats the last week, "+ Block"
 * starts from it, and each week is released on its own.
 *
 * Keyboard first: arrows move between cells (sideways only from a cell's
 * edge), Enter commits and moves down, Tab walks the row, Escape puts a cell
 * back, Alt+Up/Down moves a line. A cell saves when it is left. Exercises are
 * typed, never picked from a list; a name the athlete's library lacks is
 * created there. The outline walks with Up/Down; every ⋯ is a menu button.
 *
 * Every write goes to /api/program, which checks the coach still coaches this
 * athlete; nothing here writes Appwrite directly, and every write is an op the
 * editor already had. Edits to a published week are live on save -- see
 * docs/programs.md for why there is no second draft layer yet.
 *
 * Week | Calendar: the calendar (program-calendar.tsx) shows every week as a
 * dated row and opens a day here, in the week view, scrolled to it. The
 * choice is `?view=calendar` in the URL, written with replaceState so it
 * survives a reload and can be linked without adding a history entry.
 *
 * Seams left: backoff rules (21) and video-required (30) are columns after
 * Notes.
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

const STATE_WORD = { draft: "Draft", live: "Live", logged: "Logged" } as const;

const VIEWS = [
  { value: "week", label: "Week" },
  { value: "calendar", label: "Calendar" },
] as const;

/** The view into the URL, leaving the landing and anything else in it alone. */
function writeView(view: EditorView) {
  const url = new URL(window.location.href);
  if (view === "calendar") url.searchParams.set("view", "calendar");
  else url.searchParams.delete("view");
  window.history.replaceState(window.history.state, "", url);
}

export function ProgramEditor({
  programId,
  landing,
  view: initialView = "week",
}: {
  programId: string;
  landing?: EditorLanding;
  view?: EditorView;
}) {
  const { state: session } = useSession();
  const viewerId = session.status === "signed-in" ? session.user.id : null;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [athleteName, setAthleteName] = useState<string | null>(null);
  /** The athlete's maxes, for the unresolved-percentage warning. Null until read: unknown is not missing. */
  const [maxes, setMaxes] = useState<EditorMaxes | null>(null);
  /**
   * Days an athlete has started a session from. Undefined while reading, null
   * when it could not be read: neither is "none", so neither marks a week
   * logged nor lets a start-date change move a day.
   */
  const [logged, setLogged] = useState<ReadonlySet<string> | null | undefined>(undefined);
  // "Adjust program" from a clip opens on the week it was prescribed from.
  const [weekId, setWeekId] = useState<string | null>(landing?.weekId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [removingWeek, setRemovingWeek] = useState<string | null>(null);
  const [view, setView] = useState<EditorView>(initialView);

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
      if (tree.athleteId) {
        const athleteId = tree.athleteId;
        void Promise.all([fetchReferenceMaxes(athleteId), fetchEstimatedMaxes(athleteId)])
          .then(([entries, estimated]) => setMaxes({ entries, estimated }))
          .catch(() => {});
        const dayIds = tree.blocks.flatMap((b) => b.weeks).flatMap((w) => w.days).map((d) => d.id);
        // Days added after this read cannot have been logged yet.
        void fetchLoggedDayIds(athleteId, dayIds)
          .then(setLogged)
          .catch(() => setLogged(null));
      } else {
        setLogged(new Set());
      }
      if (tree.athleteId && tree.athleteId !== tree.coachId) {
        void fetchAthleteNames([tree.athleteId])
          .then((found) => setAthleteName(found[0]?.name ?? null))
          .catch(() => {});
      }
    })();
  }, [reload]);

  const tree = load.status === "ready" ? load.tree : null;
  const allWeeks = useMemo(() => tree?.blocks.flatMap((b) => b.weeks) ?? [], [tree]);
  const week = allWeeks.find((w) => w.id === weekId) ?? allWeeks[0] ?? null;
  const block = (week && tree?.blocks.find((b) => b.id === week.blockId)) ?? tree?.blocks[0] ?? null;
  const names = useMemo(() => new Map(exercises.map((e) => [e.id, e.name])), [exercises]);
  /** Beside each percentage the athlete will get no kilos for: which max is missing. */
  const warningFor = useCallback(
    (line: Prescription) =>
      unresolvedWarning(line, {
        maxes,
        nameOf: (id) => names.get(id),
        athleteName: tree?.athleteId === tree?.coachId ? null : athleteName,
        asOf: new Date(),
      }),
    [maxes, names, athleteName, tree?.athleteId, tree?.coachId],
  );

  // Then to its day, once, with the keyboard on the traced line so arrows
  // work straight away. A day or line no longer in the tree is not found.
  // The calendar lands the same way when a day is opened from it, with the
  // keyboard on the day's first line (or the day, when it has none or is
  // read-only). Waits for the week view: a landing on ?view=calendar applies
  // once the coach switches.
  const landingTo = useRef<{ dayId: string; lineId?: string; focusDay: boolean } | null>(
    landing?.dayId ? { dayId: landing.dayId, lineId: landing.lineId, focusDay: false } : null,
  );
  const [landings, setLandings] = useState(0);
  // A template has no dates, so no calendar: always the week view.
  const showingWeek = view === "week" || tree?.athleteId === null;
  useEffect(() => {
    const to = landingTo.current;
    if (!to || !tree || !showingWeek) return;
    landingTo.current = null;
    const section = document.getElementById(`day-${to.dayId}`);
    if (!section) return;
    section.scrollIntoView({ block: "start" });
    const day = tree.blocks.flatMap((b) => b.weeks).flatMap((w) => w.days).find((d) => d.id === to.dayId);
    const row = to.lineId ? (day?.prescriptions.findIndex((l) => l.id === to.lineId) ?? -1) : to.focusDay ? 0 : -1;
    const cell = row >= 0 ? section.querySelector<HTMLButtonElement>(`[data-cell="${row}-0"]`) : null;
    if (cell && !cell.disabled) cell.focus({ preventScroll: true });
    else if (to.focusDay) section.focus({ preventScroll: true });
  }, [tree, showingWeek, landings]);

  const changeView = (next: EditorView) => {
    setView(next);
    writeView(next);
  };

  /** From the calendar: the week view, on the day's week, scrolled to the day. */
  const openDay = (openWeekId: string, dayId: string) => {
    landingTo.current = { dayId, focusDay: true };
    setWeekId(openWeekId);
    setRemovingWeek(null);
    setLandings((n) => n + 1);
    changeView("week");
  };

  const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : "That did not save.");

  /** A structural write: send it, then read the tree back. */
  const run = async (op: ProgramOpInput): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const { rowId } = await sendProgramOp(op);
      await reload();
      return rowId;
    } catch (failure) {
      failed(failure);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Several writes in order, then one read back -- even after a failure, so
   * whatever did land is on screen rather than guessed at.
   */
  const runMany = async (work: () => Promise<string | null>): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (failure) {
      failed(failure);
      return null;
    } finally {
      await reload();
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
  const anchor = programAnchor(tree);
  const knownLogged = logged ?? null;
  const weekName = (id: string) => {
    const at = allWeeks.findIndex((w) => w.id === id);
    return allWeeks[at]?.label ?? `Week ${at + 1}`;
  };
  // "Publish week 3", "Remove heavy": the week's own label when it has one.
  const weekPhrase = (id: string) => {
    const w = allWeeks.find((x) => x.id === id);
    return w?.label ?? `week ${allWeeks.findIndex((x) => x.id === id) + 1}`;
  };

  /** "+ Week": a copy of the block's last week (duplicateWeek), or an empty one in an empty block. */
  const addWeek = async (target: BlockTree) => {
    const last = target.weeks.at(-1);
    const id = await run(last ? { op: "duplicateWeek", weekId: last.id } : { op: "addWeek", blockId: target.id });
    if (id) setWeekId(id);
  };

  /**
   * "+ Block": a new last block whose first week copies the week before it --
   * the last week of the current last block, a week later -- or is empty when
   * there is none. Written as the ops the coach could have typed.
   */
  const addBlock = async () => {
    const source = tree.blocks.at(-1)?.weeks.at(-1) ?? null;
    const shift = source ? 7 * (allWeeks.length - weekIndexOf(tree, source.id)) : 0;
    const id = await runMany(async () => {
      const { rowId: newBlock } = await sendProgramOp({
        op: "addBlock",
        programId: tree.id,
        name: `Block ${tree.blocks.length + 1}`,
      });
      const { rowId: newWeek } = await sendProgramOp({ op: "addWeek", blockId: newBlock });
      for (const { day, lines } of source ? copyWeekPlan(source, shift) : []) {
        const { rowId: dayId } = await sendProgramOp({ op: "addDay", weekId: newWeek, ...day });
        for (const line of lines) await sendProgramOp({ op: "addPrescription", dayId, ...line });
      }
      return newWeek;
    });
    if (id) setWeekId(id);
  };

  /**
   * The start date, and every day that follows it. Logged days and days
   * already outside their week stay put (redatePlan). When the sessions could
   * not be read, only the start date is saved and the coach is told why.
   */
  const changeStart = (startOn: string | null) =>
    runMany(async () => {
      const plan = logged ? redatePlan(tree, startOn, logged) : null;
      await sendProgramOp({ op: "updateProgram", programId: tree.id, startOn });
      if (plan === null) {
        if (redatePlan(tree, startOn, new Set()).length > 0) {
          setError("Start date saved. The days kept their dates: it could not be checked which ones were logged.");
        }
        return null;
      }
      for (const move of plan) await sendProgramOp({ op: "updateDay", dayId: move.dayId, scheduledOn: move.scheduledOn });
      return null;
    });

  const weekAt = week ? weekIndexOf(tree, week.id) : -1;
  const state = week ? weekState(tree, week, knownLogged) : null;
  const live = week?.status === "published" && tree.status === "published";
  const statusWord = tree.status === "published" ? "Live" : tree.status === "archived" ? "Archived" : "Draft";
  const startPrompt =
    !tree.startOn && tree.athleteId ? (
      <p className="m-0 rounded-card border border-border p-3 text-ui text-muted">
        No start date yet. Set one above and every day takes its date from its week and weekday.
        {anchor ? " Until then, dates count from the days already dated." : ""}
      </p>
    ) : null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/coach/programs" className="text-ui text-muted">
            ← Programs
          </Link>
          <InlineText
            label="Program name"
            value={tree.name}
            disabled={!editable}
            className="w-[min(40rem,100%)] text-display font-semibold"
            onCommit={(name) => (name ? run({ op: "updateProgram", programId: tree.id, name }) : null)}
          />
          <p className="m-0 text-ui text-muted">
            {tree.athleteId === tree.coachId ? "Your own training" : (athleteName ?? "Athlete")} ·{" "}
            <span aria-label="Status">{statusWord}</span>
            {tree.status === "published" && drafts > 0
              ? ` · ${drafts} draft ${drafts === 1 ? "week" : "weeks"} not on their Today yet`
              : ""}
          </p>
        </div>
        <div className="flex items-end gap-2">
          {tree.athleteId !== null ? (
            <Tabs label="View" tabs={VIEWS} value={showingWeek ? "week" : "calendar"} onChange={changeView} />
          ) : null}
          <label className="flex flex-col gap-1 text-label uppercase text-muted-2">
            Starts
            <input
              type="date"
              aria-label="Start date"
              disabled={!editable || busy}
              defaultValue={tree.startOn ?? ""}
              key={tree.startOn ?? ""}
              onBlur={(e) => {
                const value = e.target.value || null;
                if (value !== tree.startOn) void changeStart(value);
              }}
              className={cn(
                "h-9 rounded-control border bg-surface-2 px-2 text-ui text-foreground",
                !tree.startOn && tree.athleteId ? "border-accent-line" : "border-border",
              )}
            />
          </label>
          {editable ? (
            <Menu
              label="Program actions"
              disabled={busy}
              items={[
                { label: "Copy to…", onSelect: () => setCopying(true) },
                (tree.status !== "published" || drafts > 0) && {
                  // Every week at once, for a block written up front. One
                  // week at a time is the week's own Publish.
                  label: "Publish all draft weeks",
                  onSelect: () => void run({ op: "publishProgram", programId: tree.id }),
                },
              ]}
            />
          ) : null}
        </div>
      </header>

      {editable && copying ? (
        <div className="px-6 pt-4">
          <CopyProgram tree={tree} blockId={block?.id ?? null} open onClose={() => setCopying(false)} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mx-6 mt-4 mb-0 rounded-card border border-danger-line p-3 text-ui">
          {error}
        </p>
      ) : null}

      {!showingWeek ? (
        <section aria-label="Calendar" className="flex min-w-0 flex-1 flex-col gap-5 px-6 py-5">
          {startPrompt}
          {anchor && tree.blocks.length > 0 ? (
            <ProgramCalendar
              tree={tree}
              anchor={anchor}
              logged={knownLogged}
              names={names}
              weekName={weekName}
              editable={editable}
              busy={busy}
              onOpenDay={openDay}
              onAddDay={(dayWeekId, scheduledOn) => void run({ op: "addDay", weekId: dayWeekId, scheduledOn })}
            />
          ) : anchor ? (
            <p className="m-0 text-body text-muted">No blocks yet. Add one from the week view.</p>
          ) : null}
        </section>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ProgramOutline
            tree={tree}
            selectedWeekId={week?.id ?? null}
            onSelect={(id) => {
              setWeekId(id);
              setRemovingWeek(null);
            }}
            editable={editable}
            busy={busy}
            anchor={anchor}
            logged={knownLogged}
            weekName={weekName}
            onAddWeek={(b) => void addWeek(b)}
            onAddBlock={() => void addBlock()}
            onRenameBlock={(b, name) => void run({ op: "updateBlock", blockId: b.id, name })}
            onRemoveBlock={async (b) => {
              await run({ op: "removeBlock", blockId: b.id });
              if (week?.blockId === b.id) setWeekId(null);
            }}
          />

          <section aria-label="Week" className="flex min-w-0 flex-1 flex-col gap-5 px-6 py-5">
            {startPrompt}

            {block && week ? (
              <>
                <header className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
                  <div className="flex min-w-0 flex-col">
                    <h2 className="m-0 text-heading font-semibold">
                      {block.name} · {weekName(week.id)}
                    </h2>
                    <p className="m-0 text-ui text-muted">
                      {anchor ? rangeLabel(weekRange(anchor, weekAt)) : "No dates yet"} · {state ? STATE_WORD[state] : ""}
                    </p>
                  </div>
                  <span className="flex-1" />
                  {editable ? (
                    // The one publish. publishWeek takes a draft program live
                    // with it, so a coach never needs a second button to make
                    // the week reach Today. Nothing logged moves either way.
                    live ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void run({ op: "updateWeek", weekId: week.id, status: "draft" })}
                      >
                        Unpublish {weekPhrase(week.id)}
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => void run({ op: "publishWeek", weekId: week.id })}>
                        Publish {weekPhrase(week.id)}
                      </Button>
                    )
                  ) : null}
                  {editable ? (
                    <Menu
                      label={`${weekName(week.id)} actions`}
                      disabled={busy}
                      items={[
                        {
                          // A copy at the end of this block, as a draft.
                          label: `Duplicate ${weekPhrase(week.id)}`,
                          onSelect: async () => {
                            const id = await run({ op: "duplicateWeek", weekId: week.id });
                            if (id) setWeekId(id);
                          },
                        },
                        { label: `Remove ${weekPhrase(week.id)}`, tone: "danger", onSelect: () => setRemovingWeek(week.id) },
                      ]}
                    />
                  ) : null}
                </header>
                {removingWeek === week.id ? (
                  <ConfirmStrip
                    label={`Remove ${weekPhrase(week.id)}`}
                    disabled={busy}
                    onCancel={() => setRemovingWeek(null)}
                    onConfirm={async () => {
                      await run({ op: "removeWeek", weekId: week.id });
                      setWeekId(null);
                    }}
                  />
                ) : null}

                <div className="flex flex-col gap-6">
                  {week.days.length === 0 ? <p className="m-0 text-body text-muted">No days in this week yet.</p> : null}
                  {week.days.map((day, at) => (
                    <DayEditor
                      key={day.id}
                      day={day}
                      index={at}
                      editable={editable}
                      busy={busy}
                      anchor={anchor}
                      weekIndex={weekAt}
                      template={tree.athleteId === null}
                      logged={knownLogged?.has(day.id) ?? false}
                      names={names}
                      exercises={exercises}
                      warningFor={warningFor}
                      referenceFor={(exerciseId) => rememberedReference(tree, exerciseId)}
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
                        onClick={() => void run({ op: "addDay", weekId: week.id, scheduledOn: newDayDate(tree, week.id) })}
                      >
                        + Day
                      </Button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : block ? (
              <p className="m-0 text-body text-muted">This block has no weeks yet. Add one from the outline.</p>
            ) : (
              <p className="m-0 text-body text-muted">No blocks yet. Add one to start writing.</p>
            )}
          </section>
        </div>
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
  /** Week 1's Monday; null when nothing dates the program yet. */
  anchor: string | null;
  /** This day's week, counted across the program. */
  weekIndex: number;
  /** A template has no calendar: no chips. */
  template: boolean;
  /** An athlete has started a session from this day. */
  logged: boolean;
  names: ReadonlyMap<string, string>;
  exercises: readonly Exercise[];
  /** docs/reference-lift.md: the missing-max warning, and the reference a new line inherits. */
  warningFor: (line: Prescription) => string | null;
  referenceFor: (exerciseId: string) => string | null;
  run: (op: ProgramOpInput) => Promise<string | null>;
  editLine: (line: Prescription, op: ProgramOpInput) => Promise<string | null>;
  createExercise: (name: string) => Promise<Exercise | null>;
}

function DayEditor({
  day,
  index,
  editable,
  busy,
  anchor,
  weekIndex,
  template,
  logged,
  names,
  exercises,
  warningFor,
  referenceFor,
  run,
  editLine,
  createExercise,
}: DayEditorProps) {
  const title = day.label ?? `Day ${index + 1}`;
  const [removing, setRemoving] = useState(false);
  const placement = placeDay(anchor, weekIndex, day.scheduledOn);
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
    const result = commitCell(line, column, text, exercises);
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
    // The exercise's video default pre-ticks the box; the coach can untick it.
    const videoRequired = exercise.videoDefault ? true : undefined;
    // Typed once per variation per program: a new Tempo Bench line inherits
    // the last Tempo Bench line's reference lift. Sent only when there is one.
    const referenceExerciseId = referenceFor(exercise.id) ?? undefined;
    const id = await run({
      op: "addPrescription",
      dayId: day.id,
      exerciseId: exercise.id,
      setCount: 1,
      videoRequired,
      referenceExerciseId,
    });
    if (id) setFocusAfter({ lineId: id, col: "sets" });
  };

  return (
    <section
      id={`day-${day.id}`}
      aria-label={title}
      // Focusable from script only: where the calendar lands a day with no line to focus.
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 focus-visible:outline-2 focus-visible:outline-accent-line"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <InlineText
            label={`${title} name`}
            value={day.label ?? ""}
            placeholder={`Day ${index + 1}`}
            disabled={!editable}
            className="text-title font-semibold"
            onCommit={(label) => run({ op: "updateDay", dayId: day.id, label })}
          />
          {editable ? (
            <Menu
              label={`${title} actions`}
              disabled={busy}
              items={[{ label: `Remove ${title}`, tone: "danger", onSelect: () => setRemoving(true) }]}
            />
          ) : null}
        </div>
        {template ? null : (
          // The day's date is its weekday in its week. A day dated outside
          // its week (the old per-day picker) shows where it is and moves
          // only when a weekday is picked.
          <div role="group" aria-label={`${title} weekday`} className="flex items-center gap-1">
            {WEEKDAYS.map((name, weekday) => {
              const on = placement.kind === "on" && placement.weekday === weekday;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  disabled={!editable || busy || !anchor}
                  onClick={() => {
                    if (!anchor || on) return;
                    void run({ op: "updateDay", dayId: day.id, scheduledOn: scheduledOnFor(anchor, weekIndex, weekday) });
                  }}
                  className={cn(
                    "h-7 min-w-10 rounded-chip px-2 text-caption",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                    on ? "bg-accent-fill font-bold text-on-accent" : "border border-border text-muted disabled:text-muted-2",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}
        {template ? null : (
          <span className={cn("text-ui", placement.kind === "off" ? "text-danger-line" : "text-muted")}>
            {placement.kind === "undated"
              ? anchor
                ? "No date"
                : "Set a start date to date it"
              : placement.kind === "off"
                ? `${dayDateLabel(day.scheduledOn)} · outside this week`
                : dayDateLabel(day.scheduledOn)}
          </span>
        )}
        {logged ? <span className="text-caption font-semibold text-success">Logged</span> : null}
      </header>
      {removing ? (
        <ConfirmStrip
          label={`Remove ${title}`}
          disabled={busy}
          onCancel={() => setRemoving(false)}
          onConfirm={() => run({ op: "removeDay", dayId: day.id })}
        />
      ) : null}

      <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-ui">
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
            const loadKind = describeLoad(
              line.load,
              line.referenceExerciseId ? (names.get(line.referenceExerciseId) ?? "another lift") : null,
            );
            const warning = warningFor(line);
            return (
              <tr key={line.id} aria-label={`${title} line ${row + 1}: ${name}`} className="align-top">
                <td className="w-48 px-1 py-0.5">
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
                        column === "sets" || column === "reps" || column === "rest" ? "w-16" : "",
                        column === "load" ? "w-48" : "",
                        column === "backoff" ? "w-36" : "",
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
                        // The reference is part of what the load cell shows, so
                        // `70% of bench` over a stored `70%` puts the cell back.
                        key={column === "load" ? `${text}|${line.referenceExerciseId ?? ""}` : text}
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
                      {column === "load" && warning ? (
                        // The athlete will get the bare percentage. Said here,
                        // where the coach can still set the max.
                        <span className="block px-1 pt-0.5 text-caption text-danger-line" data-kind="unresolved">
                          {warning}
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
      </div>

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
