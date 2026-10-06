"use client";

import { useEffect, useState } from "react";
import { fetchEstimatedMaxes, fetchReferenceMaxes } from "@/lib/strength/reference-max-store";
import type { EstimatedInput, ReferenceMaxEntry } from "@/lib/strength/reference-max";
import { cacheProgram, cachedProgram, forgetProgram, type CachedMaxes } from "./my-program-cache";
import { fetchMyProgram } from "./program-store";
import type { ProgramTree } from "./program";
import type { AthleteMaxes } from "./use-prescribed";

/**
 * The athlete's program for My Program. Order 23.
 *
 * Stale-while-revalidate, built for a phone that is often offline: the last
 * program loaded paints first, the network refreshes it behind, and a failed
 * refresh changes nothing on screen. There is no loading spinner when there is
 * something to show and no error when the signal is simply absent -- `failed`
 * exists only for a first-ever load with no signal and nothing cached, where
 * there is genuinely nothing to draw.
 *
 * `none` is a successful answer ("no published program"), and it clears the
 * cache: a coach who unpublished a block must not keep showing on the phone.
 */

export type MyProgramState =
  | { status: "loading"; program: null; maxes: AthleteMaxes }
  | { status: "none" | "failed"; program: null; maxes: AthleteMaxes }
  | { status: "ready"; program: ProgramTree; maxes: AthleteMaxes };

const NO_MAXES: AthleteMaxes = { entries: [], estimated: new Map() };

const toMaxes = (m: CachedMaxes): AthleteMaxes => ({ entries: m.entries, estimated: new Map(m.estimated) });

export function useMyProgram(athleteId: string | null): MyProgramState {
  const [state, setState] = useState<MyProgramState>({ status: "loading", program: null, maxes: NO_MAXES });

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    void (async () => {
      // Behind an await so every update is asynchronous, as in use-prescribed.
      await Promise.resolve();
      const cached = cachedProgram(athleteId);
      if (cached && !cancelled) {
        setState({ status: "ready", program: cached.program, maxes: toMaxes(cached.maxes) });
      }
      try {
        const [program, entries, estimated] = await Promise.all([
          fetchMyProgram(athleteId),
          fetchReferenceMaxes(athleteId).then(
            (v) => v,
            () => null as ReferenceMaxEntry[] | null,
          ),
          fetchEstimatedMaxes(athleteId).then(
            (v) => v,
            () => null as Map<string, EstimatedInput> | null,
          ),
        ]);
        if (cancelled) return;
        if (!program) {
          forgetProgram();
          setState({ status: "none", program: null, maxes: NO_MAXES });
          return;
        }
        // A max read that failed keeps the cached max rather than caching "no
        // maxes", which would turn every kilo back into a percentage offline.
        const prior = cached ? toMaxes(cached.maxes) : NO_MAXES;
        const maxes: AthleteMaxes = {
          entries: entries ?? prior.entries,
          estimated: estimated ?? prior.estimated,
        };
        cacheProgram(athleteId, program, { entries: maxes.entries, estimated: [...maxes.estimated] });
        setState({ status: "ready", program, maxes });
      } catch {
        if (cancelled) return;
        // Signal lost, or Appwrite down. Keep what is on screen; with nothing
        // cached there is nothing to keep.
        setState((prev) => (prev.status === "ready" ? prev : { status: "failed", program: null, maxes: NO_MAXES }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  return state;
}
