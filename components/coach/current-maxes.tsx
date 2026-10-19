"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { coachDotsWaiting } from "@/components/strength/dots-block";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { useSession } from "@/lib/auth/session-context";
import { maxGrid, maxSource, parseKg, type MaxGridRow } from "@/lib/coach/athlete-view";
import {
  formatMaxKg,
  kindLabel,
  maxDateLabel,
  type ReferenceMaxEntry,
  type ResolvedMax,
  type StoredKind,
} from "@/lib/strength/reference-max";
import {
  fetchEstimatedMaxes,
  fetchReferenceMaxes,
  removeReferenceMax,
  setReferenceMax,
} from "@/lib/strength/reference-max-store";
import { formatDots, formatTotalBreakdown, type DotsResult } from "@/lib/strength/dots";
import { fetchDots } from "@/lib/strength/dots-store";
import { cn } from "@/lib/cn";

/**
 * CURRENT MAXES, from the Athlete View blueprint. The single most requested
 * thing on this screen: Ruairi's complaint was having to go back and remember
 * each athlete's maxes.
 *
 * Three numbers per lift, side by side -- tested, training, and the rolling
 * e1RM -- because a percentage prescription points at one of them and the
 * coach has to see which. The one a percentage uses when nothing names a kind
 * is marked.
 *
 * Tested and training are editable inline (Order 25; the write path shipped at
 * Order 17). Estimated is not and never will be: it is the best e1RM in
 * stats_rollups, and a second stored copy would leave the rebuild script
 * repairing half the data.
 *
 * Entries are append-only, so "editing" is entering a new number with a date.
 * The one true edit is Undo, straight after saving, which deletes the row just
 * written -- the typo case docs/reference-maxes.md keeps deletion for.
 *
 * Squat, bench and deadlift only, in that order (see maxGrid), with DOTS as
 * the last row of the same table rather than a block of its own (Joey's
 * review, 16 Oct 2026): it is the three numbers above it divided by
 * bodyweight, so it belongs under them. It is read with the grid and re-read
 * with it after every save, so a new max moves the score at the same moment
 * -- the old separate block kept showing the score from page load.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; rows: MaxGridRow[]; entries: ReferenceMaxEntry[]; dots: DotsResult | null }
  | { status: "failed" };

/**
 * Every piece of state remembers which athlete it belongs to. A coach clicking
 * from one athlete to the next must not see the previous athlete's numbers --
 * or an Undo for them -- under the new name, and tagging is cheaper and more
 * certain than an effect that resets on every change.
 */
type For<T> = T & { athleteId: string };

interface Editing {
  athleteId: string;
  exerciseId: string;
  kind: StoredKind;
}

interface Saved {
  athleteId: string;
  rowId: string;
  label: string;
  /** Which cell it was, so that cell can say so. */
  exerciseId: string;
  kind: StoredKind;
}

export interface CurrentMaxesProps {
  athleteId: string;
}

const todayInput = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export function CurrentMaxes({ athleteId }: CurrentMaxesProps) {
  const { state: session } = useSession();
  const viewerId = session.status === "signed-in" ? session.user.id : "";
  const [tagged, setState] = useState<For<{ state: State }>>({ athleteId, state: { status: "loading" } });
  const [editingAny, setEditing] = useState<Editing | null>(null);
  const [savedAny, setSaved] = useState<Saved | null>(null);
  const [version, setVersion] = useState(0);

  const state: State = tagged.athleteId === athleteId ? tagged.state : { status: "loading" };
  const editing = editingAny?.athleteId === athleteId ? editingAny : null;
  const saved = savedAny?.athleteId === athleteId ? savedAny : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // No reset to "loading" here: a different athlete already renders as
      // loading through the tag, and a refetch after a save keeps the grid in
      // place rather than blinking it out from under the coach's cursor.
      try {
        // The athlete's library, not the coach's: global rows plus the ones
        // this athlete typed mid-session, which the coach reads through the
        // circle team.
        //
        // DOTS through fetchDots, the one assembly both screens use, rather
        // than recomputed here from the rows just read: two assemblies of one
        // number could disagree (lib/strength/dots-store.ts). A failed DOTS
        // read is quiet -- the row is left out -- and never fails the maxes.
        const [entries, estimates, library, dots] = await Promise.all([
          fetchReferenceMaxes(athleteId),
          fetchEstimatedMaxes(athleteId),
          fetchExerciseLibrary(athleteId),
          fetchDots(athleteId).catch(() => null),
        ]);
        if (cancelled) return;
        setState({
          athleteId,
          state: { status: "ready", rows: maxGrid(entries, library, estimates, new Date()), entries, dots },
        });
      } catch {
        if (!cancelled) setState({ athleteId, state: { status: "failed" } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [athleteId, version]);

  const onSaved = useCallback((result: Saved) => {
    setEditing(null);
    setSaved(result);
    setVersion((v) => v + 1);
  }, []);

  const undo = async () => {
    if (!saved) return;
    const { rowId } = saved;
    setSaved(null);
    try {
      await removeReferenceMax(rowId);
    } finally {
      setVersion((v) => v + 1);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="current-maxes-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="current-maxes-heading" className="m-0 text-label uppercase tracking-wide text-muted">
          Current maxes
        </h2>
        {saved ? (
          <p key={saved.rowId} className="m-0 text-ui text-muted motion-safe:animate-rise-in" role="status">
            Saved {saved.label}.{" "}
            <button type="button" onClick={() => void undo()} className="underline">
              Undo
            </button>
          </p>
        ) : null}
      </div>

      {state.status === "loading" ? <p className="m-0 text-ui text-muted">Loading…</p> : null}
      {state.status === "failed" ? (
        <p className="m-0 text-ui text-muted">Couldn’t load maxes. Refresh to try again.</p>
      ) : null}
      {state.status === "ready" && state.rows.length === 0 ? (
        // Only reachable when the library has no Squat/Bench/Deadlift at all --
        // an unseeded instance. Said plainly rather than drawing a headerless
        // table.
        <p className="m-0 text-ui text-muted">
          No maxes yet. They’ll appear here once this athlete logs work or you set a training max.
        </p>
      ) : null}
      {state.status === "ready" && state.rows.length > 0 ? (
        <>
          <table className="w-full table-fixed border-collapse text-ui">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="w-[28%] py-2 pr-3 text-left font-mono text-label-xs font-normal uppercase text-muted-2">
                  Lift
                </th>
                <th scope="col" className="py-2 pr-3 text-left font-mono text-label-xs font-normal uppercase text-muted-2">
                  Tested
                </th>
                <th scope="col" className="py-2 pr-3 text-left font-mono text-label-xs font-normal uppercase text-muted-2">
                  Training
                </th>
                <th scope="col" className="py-2 text-left font-mono text-label-xs font-normal uppercase text-muted-2">
                  e1RM
                </th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.exerciseId} className="border-b border-border align-top last:border-0">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    {row.exerciseName}
                  </th>
                  {(["tested", "training"] as const).map((kind) => (
                    <td key={kind} className="py-2.5 pr-3">
                      {editing?.exerciseId === row.exerciseId && editing.kind === kind ? (
                        <MaxEditor
                          athleteId={athleteId}
                          exerciseId={row.exerciseId}
                          exerciseName={row.exerciseName}
                          kind={kind}
                          current={row[kind]}
                          onCancel={() => setEditing(null)}
                          onSaved={onSaved}
                        />
                      ) : (
                        <MaxCell
                          max={row[kind]}
                          upcoming={row.upcoming[kind]}
                          used={row.usedForPercent === kind}
                          justSaved={saved?.exerciseId === row.exerciseId && saved.kind === kind}
                          source={row[kind] ? maxSource(row[kind]!, state.entries, viewerId, athleteId) : ""}
                          onEdit={() => {
                            setSaved(null);
                            setEditing({ athleteId, exerciseId: row.exerciseId, kind });
                          }}
                          editLabel={`${row[kind] ? "Change" : "Set"} ${kindLabel(kind)} for ${row.exerciseName}`}
                        />
                      )}
                    </td>
                  ))}
                  <td className="py-2.5">
                    <MaxCell
                      max={row.estimated}
                      upcoming={null}
                      used={row.usedForPercent === "estimated"}
                      source={row.estimated ? "from logged sets" : ""}
                    />
                  </td>
                </tr>
              ))}
              {state.dots ? <DotsRow result={state.dots} /> : null}
            </tbody>
          </table>
          <p className="m-0 text-caption text-muted-2">
            <span className="text-accent-fill">●</span> is the number a percentage uses when a prescription
            doesn’t name one: training max first, then tested, then e1RM.
          </p>
        </>
      ) : null}
    </section>
  );
}

/**
 * DOTS, as the table's last row: the score where the numbers are, and the
 * total it came from beside it, so a coach can see which three lifts it was
 * built on. Kilos, as everything on the coach side is.
 */
function DotsRow({ result }: { result: DotsResult }) {
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
        DOTS
      </th>
      <td colSpan={3} className="py-2.5">
        {result.status === "ready" ? (
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold tabular-nums">{formatDots(result.score)}</span>
            <span className="text-caption text-muted tabular-nums">
              from {formatTotalBreakdown(result.lifts, "kg")} at {result.bodyweightKg.toFixed(1)} kg
              {result.stale ? (
                // The bodyweight behind it is older than the averaging window.
                // Dated rather than hidden, as on the DOTS block: an undated
                // figure reads as current.
                <span className="text-muted-2"> · weighed {weighedOn(result.measuredOn)}</span>
              ) : null}
            </span>
          </span>
        ) : (
          <span className="text-caption text-muted">{coachDotsWaiting(result)}</span>
        )}
      </td>
    </tr>
  );
}

const weighedOn = (key: string): string => {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

function MaxCell({
  max,
  upcoming,
  used,
  source,
  onEdit,
  editLabel,
  justSaved = false,
}: {
  max: ResolvedMax | null;
  upcoming: ReferenceMaxEntry | null;
  used: boolean;
  source: string;
  onEdit?: () => void;
  editLabel?: string;
  /** The cell the coach just saved: tinted once as it comes back (flash-host, globals.css). */
  justSaved?: boolean;
}) {
  const body = (
    <span className="flex flex-col items-start gap-0.5">
      <span className="flex items-baseline gap-1.5">
        {/* Tabular numerals so the column reads as a column. */}
        <span className={cn("tabular-nums", max ? "font-semibold" : "text-muted-2")}>
          {max ? formatMaxKg(max.valueKg) : "—"}
        </span>
        {used ? (
          <span aria-label="used for percentages" className="text-caption text-accent-fill">
            ●
          </span>
        ) : null}
      </span>
      {max ? (
        <span className="text-caption text-muted tabular-nums">
          {maxDateLabel(max.asOf)}
          {source ? ` · ${source}` : ""}
        </span>
      ) : null}
      {upcoming ? (
        <span className="text-caption text-muted-2 tabular-nums">
          next {formatMaxKg(upcoming.valueKg)} from {maxDateLabel(upcoming.effectiveFrom)}
        </span>
      ) : null}
    </span>
  );

  if (!onEdit) return body;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={editLabel}
      data-flash={justSaved ? "saved" : undefined}
      className={cn(
        "flash-host -m-1 rounded-chip p-1 text-left transition-control press hover:bg-surface-2 focus-visible:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
      )}
    >
      {body}
    </button>
  );
}

function MaxEditor({
  athleteId,
  exerciseId,
  exerciseName,
  kind,
  current,
  onCancel,
  onSaved,
}: {
  athleteId: string;
  exerciseId: string;
  exerciseName: string;
  kind: StoredKind;
  current: ResolvedMax | null;
  onCancel: () => void;
  onSaved: (saved: Saved) => void;
}) {
  const [value, setValue] = useState(current ? formatMaxKg(current.valueKg) : "");
  const [date, setDate] = useState(todayInput());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.select();
  }, []);

  const save = async () => {
    const valueKg = parseKg(value);
    if (valueKg === null) {
      setError("Type a weight in kilos, like 182.5.");
      return;
    }
    const [y, m, d] = date.split("-").map(Number);
    // Local midnight of the chosen day. Today's date is therefore already in
    // effect; a later one is next block's number, held back until then.
    const effectiveFrom = y && m && d ? new Date(y, m - 1, d) : undefined;

    setBusy(true);
    setError(null);
    try {
      const rowId = await setReferenceMax({ athleteId, exerciseId, kind, valueKg, effectiveFrom });
      onSaved({ athleteId, rowId, label: `${formatMaxKg(valueKg)} ${kindLabel(kind)} on ${exerciseName}`, exerciseId, kind });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t save that. Try again.");
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-1.5 motion-safe:animate-rise-in"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={input}
          inputMode="decimal"
          autoComplete="off"
          aria-label={`${kindLabel(kind)} for ${exerciseName}, kg`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 w-[72px] rounded-chip border border-border bg-surface-2 px-2 tabular-nums transition-control focus:border-accent-line focus:outline-none"
          placeholder="kg"
        />
        <input
          type="date"
          aria-label={`Takes effect from`}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-chip border border-border bg-surface-2 px-1.5 text-caption focus:border-accent-line focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="h-7 rounded-chip bg-accent-fill px-2.5 text-caption font-bold text-on-accent transition-control press enabled:hover:opacity-90 disabled:bg-surface-2 disabled:text-muted-2"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-7 px-1 text-caption text-muted transition-control hover:text-foreground focus-visible:text-foreground"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p className="m-0 text-caption text-danger-line motion-safe:animate-rise-in" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
