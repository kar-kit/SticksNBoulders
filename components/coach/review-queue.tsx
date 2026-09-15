"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/auth/session-context";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { buildQueue, firstItem, groupByAthlete, nextAfter, type QueueItem } from "@/lib/review/queue";
import {
  clearClip,
  fetchClipUrls,
  fetchClips,
  fetchExerciseNames,
  fetchRecentSets,
  fetchReviewedSetIds,
  fetchSessionSets,
  restoreClip,
  subscribeToClips,
  type RecentSet,
} from "@/lib/review/queue-store";
import { ClipContext } from "./clip-context";
import { ClipPlayer } from "./clip-player";

/**
 * The Review Queue: the screen that replaces WhatsApp.
 *
 * One list across every athlete, oldest first, cleared one clip at a time
 * without going back to a list in between. The metric the blueprint sets is
 * time to clear the queue, so the next clip's context is already on screen
 * before the coach decides anything about this one.
 *
 * Order 32 ships with clearing but no comment box. "Comment & next" is
 * Order 33, so the action here is the blueprint's Skip -- which is not a
 * degraded version of the feature but the honest half of it: a coach watching
 * a clip that is simply fine marks it seen and moves on. Saying something
 * about one arrives next.
 */

interface Detail {
  sessionSets: { exerciseId: string; setIndex: number }[];
  recent: RecentSet[];
  previousBestKg: number | null;
}

const EMPTY_DETAIL: Detail = { sessionSets: [], recent: [], previousBestKg: null };

/** Which clip the loaded context belongs to, carried with it. */
interface LoadedDetail {
  clipId: string;
  detail: Detail;
}

type Load = "loading" | "ready" | "failed";

export function ReviewQueue() {
  const { state } = useSession();
  const coachId = state.status === "signed-in" ? state.user.id : null;
  const athleteIds = useMemo(
    () => (state.status === "signed-in" ? state.coach.athleteIds : []),
    [state],
  );

  const [load, setLoad] = useState<Load>("loading");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [lastCleared, setLastCleared] = useState<QueueItem | null>(null);

  const current = useMemo(
    () => items.find((item) => item.id === currentId) ?? firstItem(items),
    [items, currentId],
  );

  const refresh = useCallback(async () => {
    if (!coachId) return;
    const [clips, reviewed] = await Promise.all([
      fetchClips(athleteIds),
      fetchReviewedSetIds(coachId),
    ]);
    const waiting = clips.filter((clip) => !reviewed.has(clip.id));
    // Names only for what is actually on screen. The exercise library of eight
    // athletes is a lot of rows to fetch for a queue of four clips.
    const [athletes, exercises] = await Promise.all([
      fetchAthleteNames(athleteIds),
      fetchExerciseNames(waiting.map((clip) => clip.exerciseId)),
    ]);
    const queue = buildQueue(clips, reviewed, {
      athletes: new Map(athletes.map((athlete) => [athlete.id, athlete.name])),
      exercises,
    });
    setItems(queue);
    return queue;
  }, [athleteIds, coachId]);

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    // Inside the async body rather than beside it, so the first paint is one
    // render rather than two.
    void (async () => {
      setLoad("loading");
      try {
        await refresh();
        if (!cancelled) setLoad("ready");
      } catch {
        if (!cancelled) setLoad("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coachId, refresh]);

  // Live, per the blueprint: a coach sitting on this screen on a Sunday sees
  // clips from athletes training that afternoon without reloading. Failure to
  // subscribe is silent -- realtime is an improvement on a screen that already
  // works, not a dependency of it.
  useEffect(() => {
    if (!coachId) return;
    try {
      const { databaseId } = browserAppwrite();
      return subscribeToClips(databaseId, () => {
        void refresh().catch(() => {});
      });
    } catch {
      return;
    }
  }, [coachId, refresh]);

  // Playback URLs for what is on screen, in one request. Re-minted when the
  // queue changes because the tickets are short-lived by design.
  useEffect(() => {
    if (items.length === 0) return;
    let cancelled = false;
    void fetchClipUrls(items.map((item) => item.videoFileId))
      .then((minted) => {
        if (!cancelled) setUrls(minted);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [items]);

  // The context panel for whatever is selected. The loaded context carries the
  // clip it belongs to, so a slow response for the previous clip can never
  // render under this one's name -- the most dangerous kind of wrong on a
  // screen that is nothing but numbers about a named person.
  const clipId = current?.id ?? null;
  const detail = loaded && loaded.clipId === clipId ? loaded.detail : EMPTY_DETAIL;

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    void (async () => {
      const [sessionSets, recent] = await Promise.all([
        fetchSessionSets(current.sessionId),
        fetchRecentSets(current.athleteId, current.exerciseId, current.loggedAt),
      ]);
      if (cancelled) return;
      const best = recent.reduce<number | null>(
        (top, set) => (set.e1rmKg !== null && (top === null || set.e1rmKg > top) ? set.e1rmKg : top),
        null,
      );
      setLoaded({ clipId: current.id, detail: { sessionSets, recent, previousBestKg: best } });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current]);

  const clear = useCallback(
    (item: QueueItem) => {
      if (!coachId) return;
      // Advance decided against the queue as it stands, before the clip leaves
      // it. Doing it the other way round shows the coach the clip they just
      // cleared when they clear the last one.
      const following = nextAfter(items, item.id);
      setItems((queue) => queue.filter((entry) => entry.id !== item.id));
      setCurrentId(following?.id ?? null);
      setLastCleared(item);
      // Optimistic. A failed write leaves the clip cleared on screen and back
      // in the queue on the next load, which is the safe direction: a clip
      // shown twice costs a moment, a clip silently dropped costs a review.
      void clearClip(coachId, item.athleteId, item.id).catch(() => {});
    },
    [coachId, items],
  );

  const undo = useCallback(() => {
    if (!coachId || !lastCleared) return;
    const restored = lastCleared;
    setLastCleared(null);
    void restoreClip(coachId, restored.id)
      .then(() => refresh())
      .then(() => setCurrentId(restored.id))
      .catch(() => {});
  }, [coachId, lastCleared, refresh]);

  // Enter clears and advances, the blueprint's "barely touch the mouse".
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !current) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      clear(current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear, current]);

  if (load === "loading") {
    return <div className="p-8 text-ui text-muted" aria-busy>Loading the queue…</div>;
  }

  if (load === "failed") {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <EmptyState
          title="The queue would not load"
          body="Your athletes' clips are still there. Reload the page, and if it keeps happening the instance is probably down."
        />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <EmptyState
          title="Nothing to review"
          body="Every clip your athletes have filmed has been watched. New ones land here as they train."
        />
        {lastCleared ? (
          <Button variant="ghost" size="sm" onClick={undo}>
            Undo — put {lastCleared.exerciseName} back
          </Button>
        ) : null}
      </div>
    );
  }

  const groups = groupByAthlete(items);

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Queue"
        className="w-[184px] flex-none overflow-y-auto border-r border-border p-4"
      >
        <p className="m-0 mb-3 text-ui font-semibold text-muted">
          {items.length} waiting
        </p>
        {groups.map((group) => (
          <div key={group.athleteId} className="mb-4">
            <p className="m-0 mb-1 text-ui font-semibold">{group.athleteName}</p>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setCurrentId(item.id)}
                    aria-current={item.id === current.id}
                    className={cn(
                      "w-full rounded-chip px-2 py-1 text-left text-ui",
                      item.id === current.id
                        ? "bg-surface-2 font-semibold text-foreground"
                        : "text-muted hover:text-foreground",
                    )}
                  >
                    {item.exerciseName}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 gap-8 overflow-y-auto p-8">
        <div className="flex-none">
          <ClipPlayer src={urls.get(current.videoFileId) ?? null} clipId={current.id} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-8">
          <ClipContext
            item={current}
            sessionSets={detail.sessionSets}
            recent={detail.recent}
            previousBestKg={detail.previousBestKg}
          />

          <div className="flex items-center gap-3">
            <Button onClick={() => clear(current)}>Reviewed — next</Button>
            {lastCleared ? (
              <Button variant="ghost" size="sm" onClick={undo}>
                Undo
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
