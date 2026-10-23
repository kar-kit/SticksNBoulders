"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingDot } from "@/components/ui/sync-mark";
import { useArrivals } from "@/components/ui/motion";
import { ClipThumb } from "@/components/video/clip-thumb";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { subscribeToQueue } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";
import { useUnits } from "@/lib/profile/units-context";
import type { ClipSet } from "@/lib/review/queue";
import { pendingUploads } from "@/lib/video/pending-store";
import { fetchMyClips } from "@/lib/video/my-clips-store";
import {
  clipLabel,
  liftOptions,
  loadLine,
  mergeClipPages,
  pendingClipIds,
  tileDate,
  withQueuedClipState,
} from "@/lib/video/my-clips";
import { cn } from "@/lib/cn";

/**
 * Clips (F13): every set the athlete has filmed, newest first, as a grid of
 * poster frames.
 *
 * Paged on the server (lib/video/my-clips-store.ts), so a year of clips is a
 * page of rows and "Load more" for the rest; thumbnails fetch only as they
 * come near the screen (ClipThumb). The lift filter queries the server too,
 * so "Squat" shows every squat clip rather than the squats that happened to
 * be in the first page.
 *
 * Offline is a state, not an error: the grid that loaded stays, a failed load
 * says nothing is lost and offers a retry, and anything changed with no
 * signal (a clip deleted, replaced, a note edited) shows as it will be once
 * the queue drains, with the pending dot.
 */

interface Loaded {
  clips: ClipSet[];
  cursor: string | null;
  /** A "Load more" in flight, or the last one failed. */
  more: "idle" | "loading" | "failed";
}

type Entry = { status: "loading" } | { status: "failed" } | ({ status: "ready" } & Loaded);

/** One cache entry per lift filter, so switching back to All does not refetch. */
const ALL = "*";

/** The first page for one filter, as the entry to store. Never throws. */
async function readFirst(athleteId: string, forKey: string): Promise<Entry> {
  try {
    const page = await fetchMyClips({ athleteId, exerciseId: forKey === ALL ? null : forKey });
    return { status: "ready", clips: page.clips, cursor: page.cursor, more: "idle" };
  } catch {
    return { status: "failed" };
  }
}

export function ClipsView() {
  const { state: session } = useSession();
  const { state: library } = useExerciseLibrary();
  const { unit } = useUnits();
  const athleteId = session.status === "signed-in" ? session.user.id : "";

  const [lift, setLift] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [uploading, setUploading] = useState(0);

  useEffect(() => subscribeToQueue(setOps), []);

  const key = lift ?? ALL;
  // No entry yet reads as loading, so the first fetch needs no state of its own.
  const entry: Entry = useMemo(() => entries[key] ?? { status: "loading" }, [entries, key]);

  // First page per filter, once. A filter already loaded is shown as it was.
  const needsFirst = athleteId !== "" && entries[key] === undefined;
  useEffect(() => {
    if (!needsFirst) return;
    let cancelled = false;
    void readFirst(athleteId, key).then((next) => {
      if (!cancelled) setEntries((current) => ({ ...current, [key]: next }));
    });
    return () => {
      cancelled = true;
    };
  }, [needsFirst, athleteId, key]);

  const retry = () => {
    const forKey = key;
    setEntries((current) => ({ ...current, [forKey]: { status: "loading" } }));
    void readFirst(athleteId, forKey).then((next) => setEntries((current) => ({ ...current, [forKey]: next })));
  };

  // Clips still on their way up from this phone have no row to show yet; one
  // line says so, rather than the grid looking like it lost them.
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    void pendingUploads()
      .then((pending) => {
        if (!cancelled) setUploading(pending.filter((upload) => upload.athleteId === athleteId).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const loadMore = async () => {
    if (entry.status !== "ready" || !entry.cursor || entry.more === "loading") return;
    const forKey = key;
    const cursor = entry.cursor;
    setEntries((current) => {
      const was = current[forKey];
      return was?.status === "ready" ? { ...current, [forKey]: { ...was, more: "loading" } } : current;
    });
    try {
      const page = await fetchMyClips({ athleteId, exerciseId: forKey === ALL ? null : forKey, cursor });
      setEntries((current) => {
        const was = current[forKey];
        if (was?.status !== "ready") return current;
        return {
          ...current,
          [forKey]: { status: "ready", clips: mergeClipPages(was.clips, page.clips), cursor: page.cursor, more: "idle" },
        };
      });
    } catch {
      setEntries((current) => {
        const was = current[forKey];
        return was?.status === "ready" ? { ...current, [forKey]: { ...was, more: "failed" } } : current;
      });
    }
  };

  const nameOf = useMemo(() => {
    const names = new Map(library.exercises.map((exercise) => [exercise.id, exercise.name]));
    return (id: string) => names.get(id) ?? "Exercise";
  }, [library.exercises]);

  const clips = useMemo(
    () => (entry.status === "ready" ? withQueuedClipState(entry.clips, ops) : []),
    [entry, ops],
  );
  const pending = useMemo(() => pendingClipIds(ops), [ops]);

  // The filter's lifts come from the unfiltered list, so choosing one does
  // not make the others vanish from the row.
  const allEntry = entries[ALL];
  const options = useMemo(
    () => liftOptions(allEntry?.status === "ready" ? allEntry.clips : [], nameOf, lift),
    [allEntry, nameOf, lift],
  );

  const isNew = useArrivals(
    clips.map((clip) => clip.id),
    key,
  );

  if (!athleteId) return null;

  return (
    <section aria-label="Clips" className="flex flex-col gap-4">
      {options.length > 1 || lift ? (
        <div role="group" aria-label="Filter by lift" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <FilterChip label="All" pressed={lift === null} onPress={() => setLift(null)} />
          {options.map((option) => (
            <FilterChip
              key={option.exerciseId}
              label={option.name}
              pressed={lift === option.exerciseId}
              onPress={() => setLift(option.exerciseId)}
            />
          ))}
        </div>
      ) : null}

      {uploading > 0 ? (
        <p role="status" className="m-0 flex items-center gap-2 text-caption text-muted">
          <PendingDot />
          {uploading === 1 ? "1 clip is" : `${uploading} clips are`} still uploading from this phone.
        </p>
      ) : null}

      {entry.status === "loading" ? (
        <p className="m-0 text-ui text-muted" aria-busy>
          Loading your clips…
        </p>
      ) : entry.status === "failed" ? (
        <EmptyState
          title="Couldn't load your clips"
          body="Nothing is lost. They'll be here when you have signal."
          action={
            <Button variant="secondary" onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : clips.length === 0 ? (
        lift ? (
          <p role="status" className="m-0 text-body text-muted">
            No {nameOf(lift)} clips yet.
          </p>
        ) : (
          <EmptyState
            title="No clips yet"
            body="Film a set from the Log and it shows up here, with the numbers already attached."
          />
        )
      ) : (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
          {clips.map((clip) => {
            const name = nameOf(clip.exerciseId);
            return (
              <li key={clip.id} className={cn(isNew(clip.id) && "motion-safe:animate-row-in")}>
                <Link
                  href={`/history/clips/${encodeURIComponent(clip.id)}`}
                  aria-label={clipLabel(clip, name, unit)}
                  className={cn(
                    "tap flex flex-col gap-1 rounded-control text-left no-underline",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                  )}
                >
                  <span className="relative">
                    <ClipThumb posterId={clip.videoPosterId ?? null} className="aspect-[3/4] w-full" />
                    {pending.has(clip.id) ? (
                      <span className="absolute right-1.5 top-1.5">
                        <PendingDot />
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 truncate text-caption font-semibold text-foreground">{name}</span>
                  <span className="flex items-baseline justify-between gap-1 text-caption text-muted">
                    <span className="truncate tabular-nums">{loadLine(clip, unit)}</span>
                    <span className="flex-none font-mono text-meta text-muted-2">{tileDate(clip.loggedAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {entry.status === "ready" && entry.cursor ? (
        <div className="flex flex-col items-center gap-2">
          <Button variant="secondary" onClick={() => void loadMore()} disabled={entry.more === "loading"}>
            {entry.more === "loading" ? "Loading…" : "Load more clips"}
          </Button>
          {entry.more === "failed" ? (
            <p role="status" className="m-0 text-caption text-muted">
              Couldn&apos;t load more. Try again when you have signal.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FilterChip({ label, pressed, onPress }: { label: string; pressed: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={cn(
        "tap h-9 flex-none whitespace-nowrap rounded-chip px-3 text-ui",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        pressed ? "bg-accent-fill font-semibold text-on-accent" : "bg-surface-2 text-muted",
      )}
    >
      {label}
    </button>
  );
}
