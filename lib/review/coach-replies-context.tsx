"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import type { Comment } from "./comments";
import { markFor, replyThreads, unreadThreadCount, type ReplyThread } from "./replies";
import { fetchThreadComments, fetchThreadReads, saveThreadRead, subscribeToThreads } from "./replies-store";

/**
 * The coach's Replies state, held once for the whole coach side (F26).
 *
 * Mounted by the coach layout, so the nav badge, the Replies screen and every
 * place a thread can be opened -- Athlete View's clip dialog, the Review
 * Queue -- read and clear the same numbers. A badge that still says 2 after
 * the coach has just read both is the bug this file exists to prevent.
 *
 * Outside the provider (a component test, the athlete side) every hook here
 * is a quiet no-op, so a screen that marks threads read needs no provider to
 * render.
 */

export type RepliesStatus = "idle" | "loading" | "ready" | "failed";

export interface CoachReplies {
  status: RepliesStatus;
  threads: readonly ReplyThread[];
  /** Threads with anything unread: the number beside "Replies". */
  unreadCount: number;
  /**
   * Marks one thread read, as far as `shown` goes (the comments the screen
   * actually has up), or through its newest comment when `shown` is omitted.
   * Writes nothing when that would clear nothing.
   */
  markRead: (setId: string, shown?: readonly Comment[]) => void;
}

const QUIET: CoachReplies = { status: "idle", threads: [], unreadCount: 0, markRead: () => {} };

const RepliesContext = createContext<CoachReplies>(QUIET);

interface Loaded {
  key: string;
  status: "ready" | "failed";
  comments: Comment[];
  reads: ReadonlyMap<string, string>;
}

const NO_COMMENTS: Comment[] = [];
const NO_READS: ReadonlyMap<string, string> = new Map();

/** The later of the two marks per thread. Pending marks only ever move one forward. */
export function mergeMarks(server: ReadonlyMap<string, string>, pending: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  if (pending.size === 0) return server;
  const merged = new Map(server);
  for (const [setId, at] of pending) {
    const had = merged.get(setId);
    if (!had || new Date(at).getTime() > new Date(had).getTime()) merged.set(setId, at);
  }
  return merged;
}

export const useCoachReplies = (): CoachReplies => useContext(RepliesContext);

/**
 * Marks a thread read while a screen has it open.
 *
 * Re-runs when the thread's unread count changes, so a deep link that opened
 * the dialog before the inbox had loaded still clears it once it has -- but
 * only as far as `shown`, so a reply arriving live while the dialog shows an
 * older copy of the thread stays unread until the coach actually sees it.
 */
export function useMarkThreadRead(setId: string | null, shown: readonly Comment[]): void {
  const { threads, markRead } = useCoachReplies();
  const unread = setId ? (threads.find((thread) => thread.setId === setId)?.unread ?? 0) : 0;
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  });
  // `shown.length` too: a thread whose comments arrive after it opened.
  const count = shown.length;
  useEffect(() => {
    if (setId && unread > 0) markRead(setId, shownRef.current);
  }, [setId, unread, count, markRead]);
}

export function CoachRepliesProvider({
  coachId,
  athleteIds,
  children,
}: {
  coachId: string | null;
  athleteIds: readonly string[] | null;
  children: React.ReactNode;
}) {
  // A stable key, because the session hands over a new array on every refresh.
  const athleteKey = athleteIds ? [...athleteIds].sort().join(",") : "";
  const scope = useMemo(
    () => ({ coachId: coachId ?? "", athleteIds: athleteKey ? athleteKey.split(",") : [] }),
    [coachId, athleteKey],
  );
  const key = `${scope.coachId}|${athleteKey}`;
  const active = scope.coachId !== "" && scope.athleteIds.length > 0;

  // What was read, tagged with who it was read for, so a change of coach or
  // roster shows "loading" rather than the previous roster's replies -- derived
  // on render, not reset in an effect.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Marks written from this tab and not yet seen back from the server. Merged
  // over what was read, so a realtime reload landing between the tap and the
  // write cannot flash the badge back on.
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(new Map());

  // One read at a time. A burst of realtime events -- an athlete replying to
  // three clips in a row -- costs one more read after the one in flight, not
  // three.
  const loading = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (loading.current) {
      again.current = true;
      return loading.current;
    }
    const mine = generation.current;
    const run = (async () => {
      do {
        again.current = false;
        try {
          const [found, marks] = await Promise.all([
            fetchThreadComments(scope.athleteIds),
            fetchThreadReads(scope.coachId),
          ]);
          if (generation.current !== mine) return;
          setLoaded({
            key,
            status: "ready",
            comments: found,
            reads: new Map([...marks].map(([setId, mark]) => [setId, mark.lastReadAt])),
          });
        } catch {
          // A failed re-read keeps what is on screen; only a first load fails.
          if (generation.current === mine) {
            setLoaded((prev) =>
              prev?.key === key && prev.status === "ready" ? prev : { key, status: "failed", comments: [], reads: new Map() },
            );
          }
        }
      } while (again.current && generation.current === mine);
    })();
    loading.current = run;
    try {
      await run;
    } finally {
      if (loading.current === run) loading.current = null;
    }
  }, [scope, key]);

  useEffect(() => {
    generation.current += 1;
    loading.current = null;
    if (!active) return;
    void load();
    try {
      const { databaseId } = browserAppwrite();
      return subscribeToThreads(databaseId, () => void load());
    } catch {
      return undefined;
    }
  }, [active, load]);

  const current = active && loaded?.key === key ? loaded : null;
  const status: RepliesStatus = !scope.coachId ? "idle" : !active ? "ready" : (current?.status ?? "loading");
  const comments = current?.comments ?? NO_COMMENTS;
  const serverReads = current?.reads ?? NO_READS;
  const reads = useMemo(() => mergeMarks(serverReads, pending), [serverReads, pending]);
  const threads = useMemo(() => replyThreads(comments, reads, scope), [comments, reads, scope]);

  // Read through refs so markRead keeps one identity: the screens call it from
  // effects, and a new function on every inbox change would re-run them. A
  // layout effect, because children's passive effects run before this
  // component's: a screen marking the thread the moment the inbox loads must
  // already see the loaded inbox.
  const latest = useRef({ threads, comments, reads, scope, load });
  useLayoutEffect(() => {
    latest.current = { threads, comments, reads, scope, load };
  });

  const markRead = useCallback((setId: string, shown?: readonly Comment[]) => {
    const now = latest.current;
    const thread = now.threads.find((t) => t.setId === setId);
    const setComments = now.comments.filter((c) => c.setId === setId);
    const through = markFor(thread, now.reads.get(setId), now.scope.coachId, setComments, shown);
    if (!thread || !through) return;
    // Optimistic: the badge drops as the thread opens, not a round trip later.
    setPending((prev) => new Map(prev).set(setId, through));
    void saveThreadRead(now.scope.coachId, { athleteId: thread.athleteId, setId, lastReadAt: through })
      .then(() => now.load())
      .catch(() => {
        // Refused or offline: drop the optimistic mark and re-read, so the
        // badge shows what the server holds rather than a clear that never
        // landed. An unlinked athlete's thread leaves the list on that read.
        setPending((prev) => {
          const next = new Map(prev);
          if (next.get(setId) === through) next.delete(setId);
          return next;
        });
        void now.load();
      });
  }, []);

  const value = useMemo<CoachReplies>(
    () => ({ status, threads, unreadCount: unreadThreadCount(threads), markRead }),
    [status, threads, markRead],
  );

  return <RepliesContext.Provider value={value}>{children}</RepliesContext.Provider>;
}
