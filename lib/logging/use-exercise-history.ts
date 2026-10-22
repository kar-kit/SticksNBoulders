"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fetchExerciseHistory, type ExerciseHistory } from "./exercise-history-store";
import {
  forgetRememberedExerciseHistory,
  recallExerciseHistory,
  rememberExerciseHistory,
} from "./exercise-history-cache";

/**
 * Last time and the bests to beat, for every exercise on the Log, read in the
 * background and held for the session.
 *
 * - **Never blocks.** Nothing on the screen waits for it; a block renders at
 *   once and its Previous lines and badges appear when the read lands.
 * - **One read per exercise per session**, deduped across blocks, renders
 *   and screens. The cache is the module, not the component, so opening a
 *   lift's history and coming back does not read it again.
 * - **Offline is not an error.** A read that fails leaves the exercise out of
 *   the map, which every caller treats as "nothing to show". It is tried
 *   again when the browser reports it is back online, or when the screen
 *   asks for the exercise again (a new block, a swap).
 *
 * - **Survives a reload.** A read that landed is kept on the device for the
 *   session (exercise-history-cache.ts) and used instead of reading again,
 *   so a reload with no signal still has its Previous lines and badges.
 *
 * Keyed by athlete, session and exercise: the bests are frozen at the
 * session's start, so a new session must read them afresh.
 */

type Entry = { status: "loading" } | { status: "ready"; value: ExerciseHistory } | { status: "failed" };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (athleteId: string, sessionId: string, exerciseId: string) =>
  `${athleteId}\u0000${sessionId}\u0000${exerciseId}`;

function announce() {
  version += 1;
  for (const listener of listeners) listener();
}

function load(athleteId: string, sessionId: string, sessionStart: Date, exerciseId: string) {
  const key = keyOf(athleteId, sessionId, exerciseId);
  const entry = cache.get(key);
  if (entry && entry.status !== "failed") return;
  const remembered = recallExerciseHistory(athleteId, sessionId, exerciseId);
  if (remembered) {
    cache.set(key, { status: "ready", value: remembered });
    announce();
    return;
  }
  cache.set(key, { status: "loading" });
  fetchExerciseHistory(athleteId, exerciseId, sessionId, sessionStart).then(
    (value) => {
      cache.set(key, { status: "ready", value });
      rememberExerciseHistory(athleteId, sessionId, exerciseId, value);
      announce();
    },
    () => {
      cache.set(key, { status: "failed" });
      announce();
    },
  );
}

/** For tests: forget everything read, on the device too. */
export function forgetExerciseHistory(): void {
  cache.clear();
  forgetRememberedExerciseHistory();
  announce();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => version;

export function useExerciseHistory(
  athleteId: string | null,
  sessionId: string | null,
  sessionStart: Date | null,
  exerciseIds: readonly string[],
): ReadonlyMap<string, ExerciseHistory> {
  const seen = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [online, setOnline] = useState(0);
  const ids = useMemo(() => [...new Set(exerciseIds)].sort(), [exerciseIds]);
  const idsKey = ids.join("\u0000");
  const startMs = sessionStart?.getTime() ?? null;

  useEffect(() => {
    const retry = () => setOnline((n) => n + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  useEffect(() => {
    if (!athleteId || !sessionId || startMs === null) return;
    for (const id of idsKey ? idsKey.split("\u0000") : []) load(athleteId, sessionId, new Date(startMs), id);
  }, [athleteId, sessionId, startMs, idsKey, online]);

  return useMemo(() => {
    const ready = new Map<string, ExerciseHistory>();
    if (!athleteId || !sessionId) return ready;
    for (const id of idsKey ? idsKey.split("\u0000") : []) {
      const entry = cache.get(keyOf(athleteId, sessionId, id));
      if (entry?.status === "ready") ready.set(id, entry.value);
    }
    return ready;
    // `seen` is the cache's version: a read landing is what changes the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, sessionId, idsKey, seen]);
}
