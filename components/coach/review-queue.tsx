"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/auth/session-context";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { fetchCoachStatus } from "@/lib/auth/role";
import { subscribeToLinks } from "@/lib/coach/coach-links-store";
import { droppedClipsNotice, reconcileDropped, sameAthletes } from "@/lib/coach/link-status";
import { buildQueue, firstItem, groupByAthlete, nextAfter, type QueueItem } from "@/lib/review/queue";
import { countBySet, type Comment } from "@/lib/review/comments";
import { fetchCommentsForSets, submitComment } from "@/lib/review/comment-store";
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
import { CommentBox } from "./comment-box";

/**
 * The Review Queue: the screen that replaces WhatsApp.
 *
 * One list across every athlete, oldest first, cleared one clip at a time
 * without going back to a list in between. The metric the blueprint sets is
 * time to clear the queue, so the next clip's context is already on screen
 * before the coach decides anything about this one.
 *
 * Two ways out of a clip, both from the blueprint. "Comment & next" says
 * something and advances in one action; Skip advances without, for a clip that
 * is simply fine. Both clear it from the queue, because both mean the coach has
 * dealt with it.
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
  const { state, refresh: refreshSession } = useSession();
  const coachId = state.status === "signed-in" ? state.user.id : null;
  const sessionAthleteIds = state.status === "signed-in" ? state.coach.athleteIds : null;

  const [load, setLoad] = useState<Load>("loading");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [lastCleared, setLastCleared] = useState<QueueItem | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [posting, setPosting] = useState(false);
  const [athleteNames, setAthleteNames] = useState<Map<string, string>>(new Map());
  const [dropped, setDropped] = useState<ReadonlyMap<string, string>>(new Map());

  // Order 16.6. Read through refs so the queue can compare what it is about to
  // show with what it showed, and correct the session, without either becoming
  // a dependency that re-runs the load it is part of.
  //
  // itemsRef is written where the queue changes, not in an effect after render.
  // A passive effect runs after the browser can already paint, so a link event
  // landing in that gap would compare against the previous queue, find nothing
  // to drop, and empty the screen without saying why.
  const itemsRef = useRef<QueueItem[]>([]);
  const sessionIdsRef = useRef(sessionAthleteIds);
  const refreshSessionRef = useRef(refreshSession);
  const commitItems = useCallback((next: QueueItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  useEffect(() => {
    sessionIdsRef.current = sessionAthleteIds;
    refreshSessionRef.current = refreshSession;
  });

  const current = useMemo(
    () => items.find((item) => item.id === currentId) ?? firstItem(items),
    [items, currentId],
  );

  const refresh = useCallback(async () => {
    if (!coachId) return;
    // Who is linked NOW, read fresh rather than taken from the session. The
    // session was resolved when the app loaded; an athlete who unlinked since
    // would otherwise stay in the IN filter, their clips on screen, and every
    // action on them would fail against a circle the coach has left.
    const { athleteIds } = await fetchCoachStatus(coachId);
    const active = new Set(athleteIds);
    // Counted before anything is replaced, so the coach is told why clips
    // vanished rather than left wondering whether they cleared them.
    const onScreen = itemsRef.current;
    setDropped((already) => reconcileDropped(already, onScreen, active));
    // The rail and the Review badge read the session. Refreshed only when it
    // actually disagrees, which also catches a re-link without a reload.
    if (sessionIdsRef.current && !sameAthletes(athleteIds, sessionIdsRef.current)) {
      void refreshSessionRef.current().catch(() => {});
    }
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
    const byId = new Map(athletes.map((athlete) => [athlete.id, athlete.name]));
    const queue = buildQueue(clips, reviewed, { athletes: byId, exercises });
    setAthleteNames(byId);
    commitItems(queue);
    // What has already been said about what is waiting. Read with the queue
    // rather than per clip, so a coach who commented last Sunday sees it the
    // moment the clip opens instead of a blank box that invites a repeat.
    setComments(await fetchCommentsForSets(queue.map((item) => item.id)));
    return queue;
  }, [coachId, commitItems]);

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
      const stopClips = subscribeToClips(databaseId, () => {
        void refresh().catch(() => {});
      });
      // An athlete unlinking reaches this screen live too: their clips leave,
      // and a half-written comment on one goes with it -- the Build Plan's
      // "drafts flush on revoke", since the comment box resets per clip. A
      // re-link brings the clips back the same way.
      const stopLinks = subscribeToLinks(databaseId, () => {
        void refresh().catch(() => {});
      });
      return () => {
        stopClips();
        stopLinks();
      };
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
      commitItems(itemsRef.current.filter((entry) => entry.id !== item.id));
      setCurrentId(following?.id ?? null);
      setLastCleared(item);
      // Optimistic. A failed write leaves the clip cleared on screen and back
      // in the queue on the next load, which is the safe direction: a clip
      // shown twice costs a moment, a clip silently dropped costs a review.
      //
      // A refused write is also how a revoked link shows up between realtime
      // events -- the review row is stamped with a circle the coach has left --
      // so it re-reads, which drops that athlete's clips with a reason.
      void clearClip(coachId, item.athleteId, item.id).catch(() => {
        void refresh().catch(() => {});
      });
    },
    [coachId, items, refresh, commitItems],
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

  /**
   * Says something, then clears.
   *
   * Two writes, in this order on purpose. If the comment lands and the review
   * does not, the clip comes back with the comment already on it and the coach
   * sees what they said -- a duplicate they can skip. The other order loses the
   * feedback entirely and shows an empty box, which is the same screen as
   * having never commented at all.
   */
  const commentAndNext = useCallback(
    async (item: QueueItem, body: string): Promise<boolean> => {
      if (!coachId) return false;
      setPosting(true);
      try {
        const outcome = await submitComment({
          athleteId: item.athleteId,
          setId: item.id,
          authorId: coachId,
          body,
        });
        if (!outcome.ok) {
          // Possibly not the network: the athlete may have unlinked since the
          // queue loaded. Re-reading settles it -- if they did, the clip leaves
          // and the draft with it, and the notice says why.
          if (outcome.reason === "failed") void refresh().catch(() => {});
          return false;
        }
        setComments((all) => [...all, outcome.comment]);
        clear(item);
        return true;
      } finally {
        setPosting(false);
      }
    },
    [clear, coachId, refresh],
  );

  // Enter clears and advances, the blueprint's "barely touch the mouse". Never
  // while the coach is writing -- the comment box owns Cmd/Ctrl+Enter, and a
  // bare Enter there is a new paragraph.
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

  const droppedNotice = droppedClipsNotice(dropped.size);

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        {droppedNotice ? (
          <p role="status" className="m-0 max-w-[420px] text-center text-ui text-muted">
            {droppedNotice}
          </p>
        ) : null}
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
  const commentCounts = countBySet(comments);

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Queue"
        className="w-[184px] flex-none overflow-y-auto border-r border-border p-4"
      >
        <p className="m-0 mb-3 text-ui font-semibold text-muted">
          {items.length} waiting
        </p>
        {droppedNotice ? (
          <p role="status" className="m-0 mb-3 text-caption text-muted-2">
            {droppedNotice}
          </p>
        ) : null}
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
                    {commentCounts.has(item.id) ? (
                      // A clip already spoken about. Marked rather than hidden:
                      // it is still waiting to be cleared, and the coach should
                      // know they have been here before opening it.
                      <span className="ml-1 text-muted-2" aria-label="already commented">
                        ·
                      </span>
                    ) : null}
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

          <div className="flex flex-col gap-3">
            <CommentBox
              clipId={current.id}
              comments={comments.filter((comment) => comment.setId === current.id)}
              names={athleteNames}
              viewerId={coachId ?? ""}
              busy={posting}
              onPost={(body) => commentAndNext(current, body)}
              onSkip={() => clear(current)}
            />
            {lastCleared ? (
              <Button variant="ghost" size="sm" onClick={undo} className="self-start">
                Undo
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
