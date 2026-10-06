"use client";

import { useEffect, useState } from "react";
import { fetchEstimatedMaxes, fetchReferenceMaxes } from "@/lib/strength/reference-max-store";
import type { EstimatedInput, ReferenceMaxEntry } from "@/lib/strength/reference-max";
import { fetchPrescribedDay, fetchPrescribedDayById, type PrescribedDay } from "./program-store";
import { localDay } from "./program";

/**
 * The prescribed day for Today and for Log Session, with the maxes its
 * percentages resolve against. Order 22.
 *
 * A failed read is not an error screen. Free logging stays first-class, so an
 * athlete in a basement with no signal sees the no-program layout and can
 * still start a session -- the same rule Today already applies to sessions.
 * A failed max read is quieter still: the day shows, and its percentages show
 * as percentages, which is Order 18's honest failure.
 */

export interface AthleteMaxes {
  entries: ReferenceMaxEntry[];
  estimated: Map<string, EstimatedInput>;
}

export type PrescribedState =
  | { status: "idle" | "loading" | "none" | "failed"; day: null; maxes: AthleteMaxes }
  | { status: "ready"; day: PrescribedDay; maxes: AthleteMaxes };

const NO_MAXES: AthleteMaxes = { entries: [], estimated: new Map() };

async function loadMaxes(athleteId: string): Promise<AthleteMaxes> {
  const [entries, estimated] = await Promise.all([
    fetchReferenceMaxes(athleteId).catch(() => [] as ReferenceMaxEntry[]),
    fetchEstimatedMaxes(athleteId).catch(() => new Map<string, EstimatedInput>()),
  ]);
  return { entries, estimated };
}

function usePrescribed(key: string | null, load: () => Promise<PrescribedDay | null>, athleteId: string | null) {
  const [state, setState] = useState<PrescribedState>({ status: "idle", day: null, maxes: NO_MAXES });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Behind an await so the update is asynchronous, the shape the providers use.
      await Promise.resolve();
      if (!key || !athleteId) {
        if (!cancelled) setState({ status: "idle", day: null, maxes: NO_MAXES });
        return;
      }
      if (!cancelled) setState((prev) => ({ ...prev, status: "loading", day: null }) as PrescribedState);
      try {
        const [day, maxes] = await Promise.all([load(), loadMaxes(athleteId)]);
        if (cancelled) return;
        setState(day ? { status: "ready", day, maxes } : { status: "none", day: null, maxes });
      } catch {
        if (!cancelled) setState({ status: "failed", day: null, maxes: NO_MAXES });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `load` closes over `key`, which is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, athleteId]);

  return state;
}

/** What is prescribed for this athlete on their own calendar day. */
export function usePrescribedToday(athleteId: string | null, on: string = localDay()): PrescribedState {
  return usePrescribed(athleteId ? `${athleteId}:${on}` : null, () => fetchPrescribedDay(athleteId!, on), athleteId);
}

/** The day a running session was started from. Idle for a free session. */
export function usePrescribedSession(dayId: string | null | undefined, athleteId: string | null): PrescribedState {
  return usePrescribed(dayId ?? null, () => fetchPrescribedDayById(dayId!), athleteId);
}
