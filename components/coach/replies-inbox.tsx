"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { UserAvatar } from "@/components/profile/user-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { useArrivals } from "@/components/ui/motion";
import { useSession } from "@/lib/auth/session-context";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { shortDate } from "@/lib/coach/athlete-view";
import { formatNumber } from "@/lib/logging/prefill";
import { cn } from "@/lib/cn";
import { useCoachReplies } from "@/lib/review/coach-replies-context";
import { fetchExerciseNames } from "@/lib/review/queue-store";
import { postedAt, snippet, threadViewHref, type ReplyThread } from "@/lib/review/replies";
import { fetchThreadSets, type ThreadSet } from "@/lib/review/replies-store";

/**
 * Replies (F26): every thread an athlete has answered in, newest first.
 *
 * The Review Queue is about footage and empties as the coach clears it. This
 * is about words: what an athlete said back, against the set it is about, so
 * the coach knows who is waiting on him without opening every clip. A reply
 * on a clip he already cleared lands here and leaves the queue alone -- one
 * signal for one event (docs/replies.md).
 *
 * A row opens the thread where it is already read: the clip dialog over
 * Athlete View, the same player and thread as everywhere else. Opening it
 * there marks it read, on every device, so the badge and the bold row clear
 * together. The tap marks it too, so a thread whose clip has since gone still
 * clears.
 *
 * Read threads stay, unbolded, because "what did Joey say on Tuesday" is a
 * question this screen should answer as well.
 */

type Context = { sets: ReadonlyMap<string, ThreadSet>; exercises: ReadonlyMap<string, string> };

const loadLabel = (set: ThreadSet) =>
  `${formatNumber(set.loadKg)} × ${set.reps}${set.rpe === null ? "" : ` @${formatNumber(set.rpe)}`}${set.failed ? " · failed" : ""}`;

export function RepliesInbox() {
  const { state } = useSession();
  const athleteIds = state.status === "signed-in" ? state.coach.athleteIds : null;
  const { status, threads, unreadCount, markRead } = useCoachReplies();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [context, setContext] = useState<Context>({ sets: new Map(), exercises: new Map() });

  const athleteKey = (athleteIds ?? []).join(",");
  useEffect(() => {
    const ids = athleteKey ? athleteKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    void fetchAthleteNames(ids)
      .then((found) => {
        if (!cancelled) setNames(new Map(found.map((a) => [a.id, a.name])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [athleteKey]);

  // The lift and numbers for each thread, read for the sets on screen only.
  const setKey = threads.map((t) => t.setId).join(",");
  useEffect(() => {
    const ids = setKey ? setKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const sets = await fetchThreadSets(ids);
      const exercises = await fetchExerciseNames([...sets.values()].map((s) => s.exerciseId));
      if (!cancelled) setContext({ sets, exercises });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setKey]);

  const linked = useMemo(() => new Set(athleteIds ?? []), [athleteIds]);
  const visible = threads.filter((thread) => linked.has(thread.athleteId));
  const isNew = useArrivals(
    visible.map((t) => t.setId),
    status,
  );

  if (athleteIds && athleteIds.length === 0) {
    return (
      <Centred>
        <EmptyState
          title="No replies yet"
          body="Once an athlete is linked and answers something you said on a clip, it lands here."
        />
      </Centred>
    );
  }
  if (status === "idle" || status === "loading") {
    return (
      <p role="status" className="m-0 p-4 text-ui text-muted md:p-8">
        Loading…
      </p>
    );
  }
  if (status === "failed") {
    return (
      <Centred>
        <EmptyState title="Couldn’t load replies" body="Check your connection and refresh to try again." />
      </Centred>
    );
  }
  if (visible.length === 0) {
    return (
      <Centred>
        <EmptyState
          title="No replies yet"
          body="When an athlete answers something you said on a clip, it lands here with the set it is about."
        />
      </Centred>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 animate-fade-in md:gap-8 md:p-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="m-0 text-display font-semibold">Replies</h1>
        <span className="text-ui text-muted">{unreadCount > 0 ? `${unreadCount} unread` : "All read"}</span>
      </header>
      <ul className="m-0 flex max-w-[760px] list-none flex-col gap-1.5 p-0">
        {visible.map((thread) => (
          <li key={thread.setId} className={cn(isNew(thread.setId) && "motion-safe:animate-rise-in")}>
            <ReplyRow
              thread={thread}
              name={names.get(thread.athleteId) ?? null}
              set={context.sets.get(thread.setId) ?? null}
              exercise={context.exercises}
              onOpen={() => markRead(thread.setId)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Centred({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-4 md:p-8">{children}</div>;
}

function ReplyRow({
  thread,
  name,
  set,
  exercise,
  onOpen,
}: {
  thread: ReplyThread;
  name: string | null;
  set: ThreadSet | null;
  exercise: ReadonlyMap<string, string>;
  onOpen: () => void;
}) {
  const unread = thread.unread > 0;
  const who = name ?? "Unnamed athlete";
  const lift = set ? (exercise.get(set.exerciseId) ?? "Unknown lift") : null;
  const when = shortDate(new Date(postedAt(thread.latest)));
  return (
    <Link
      href={threadViewHref(thread.athleteId, thread.setId)}
      onClick={onOpen}
      className={cn(
        "flex w-full items-start gap-3 rounded-control border px-3 py-2.5 text-left",
        "transition-control press-wide hover:bg-surface-2 focus-visible:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        unread ? "border-accent-line bg-surface" : "border-border",
      )}
    >
      <UserAvatar userId={thread.athleteId} name={who} size={28} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("min-w-0 truncate text-ui", unread ? "font-semibold" : "font-medium")}>
            {who}
            {lift && set ? (
              <span className="font-normal text-muted">
                {" "}
                · {lift} <span className="tabular-nums">{loadLabel(set)}</span>
                {set.loggedAt ? ` · ${shortDate(new Date(set.loggedAt))}` : ""}
              </span>
            ) : null}
          </span>
          <span className="flex flex-none items-baseline gap-2">
            {unread ? (
              <span className="font-mono text-caption font-medium text-accent-fill">
                {thread.unread === 1 ? "New" : `${thread.unread} new`}
              </span>
            ) : null}
            <span className="font-mono text-meta text-muted-2">{when}</span>
          </span>
        </span>
        <span className={cn("truncate text-caption", unread ? "text-foreground" : "text-muted")}>
          {snippet(thread.latest.body)}
        </span>
      </span>
    </Link>
  );
}
