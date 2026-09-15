"use client";

import { useEffect, useState } from "react";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import {
  buildMaxRows,
  formatMaxKg,
  kindLabel,
  maxDateLabel,
  type MaxRow,
} from "@/lib/strength/reference-max";
import { fetchEstimatedMaxes, fetchReferenceMaxes } from "@/lib/strength/reference-max-store";

/**
 * CURRENT MAXES, from the Athlete View blueprint.
 *
 * The panel exists because this is where programming gets its numbers: a
 * percentage prescription points at one of these, so a coach writing a block
 * needs to see what they are pointing at.
 *
 * Read-only for now, deliberately. The blueprint puts an "edit / set training
 * max" control here, and that belongs with the rest of the Athlete View at
 * Order 25 -- building the editor now means building it against a screen that
 * does not exist and rebuilding it when it does.
 *
 * Every number carries its source and its date, which is the whole point of
 * the panel. "212" alone is a number somebody has to go and verify; "212 e1RM
 * 11 Sep" is one they can act on.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; rows: MaxRow[] }
  | { status: "failed" };

export interface CurrentMaxesProps {
  athleteId: string;
}

export function CurrentMaxes({ athleteId }: CurrentMaxesProps) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Reset inside the async body, not beside it: a coach clicking from one
      // athlete to the next must not see the previous athlete's numbers under
      // the new name, and a synchronous setState here is an extra render.
      setState({ status: "loading" });
      try {
        // The athlete's library, not the coach's: global rows plus the ones
        // this athlete typed mid-session, which the coach reads through the
        // circle team.
        const [entries, estimates, library] = await Promise.all([
          fetchReferenceMaxes(athleteId),
          fetchEstimatedMaxes(athleteId),
          fetchExerciseLibrary(athleteId),
        ]);
        if (cancelled) return;

        const rows = buildMaxRows(
          entries,
          library.map((exercise) => ({
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            estimated: estimates.get(exercise.id) ?? null,
          })),
          new Date(),
        );
        setState({ status: "ready", rows });
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-label uppercase tracking-wide text-muted">Current maxes</h2>
      {state.status === "loading" ? (
        <p className="m-0 text-ui text-muted">Loading…</p>
      ) : null}
      {state.status === "failed" ? (
        <p className="m-0 text-ui text-muted">Couldn’t load maxes. Refresh to try again.</p>
      ) : null}
      {state.status === "ready" && state.rows.length === 0 ? (
        <p className="m-0 text-ui text-muted">
          No maxes yet. They’ll appear here once this athlete logs work or you set a training max.
        </p>
      ) : null}
      {state.status === "ready" && state.rows.length > 0 ? (
        <table className="w-full border-collapse text-ui">
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.exerciseId} className="border-b border-border last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {row.exerciseName}
                </th>
                <td className="py-2 pr-4 text-muted">{kindLabel(row.max.kind)}</td>
                {/* Tabular numerals so the column reads as a column. */}
                <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                  {formatMaxKg(row.max.valueKg)}
                </td>
                <td className="py-2 text-right text-muted tabular-nums">
                  {maxDateLabel(row.max.asOf)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
