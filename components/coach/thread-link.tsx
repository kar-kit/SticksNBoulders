"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/lib/auth/session-context";
import { useCoachReplies } from "@/lib/review/coach-replies-context";
import { threadViewHref } from "@/lib/review/replies";
import { fetchSetOwner } from "@/lib/review/replies-store";

/**
 * Behind `/coach/replies/<setId>` (F26): finds whose set this is and hands
 * over to the clip dialog over Athlete View, replacing itself in history so
 * Back returns to wherever the coach came from rather than to a hop.
 *
 * Whose set it is comes from the inbox when the thread is in it, and from the
 * set itself otherwise -- a deep link opened cold, from a notification, before
 * the inbox has loaded. Only an athlete linked to this coach now is followed:
 * the circle would refuse the rest anyway, and saying so here is better than
 * an empty Athlete View.
 *
 * The dialog marks the thread read once it is up (`useMarkThreadRead`); the
 * hand-over marks it too, so a thread whose clip has gone still clears.
 */
export function ThreadLink({ setId }: { setId: string }) {
  const router = useRouter();
  const { state } = useSession();
  const athleteIds = state.status === "signed-in" ? state.coach.athleteIds : null;
  const { threads, markRead } = useCoachReplies();
  const [unavailable, setUnavailable] = useState(false);
  const known = threads.find((thread) => thread.setId === setId)?.athleteId ?? null;
  const linkedKey = (athleteIds ?? []).join(",");
  const signedIn = athleteIds !== null;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const linked = new Set(linkedKey ? linkedKey.split(",") : []);
    void (async () => {
      const athleteId = known ?? (await fetchSetOwner(setId));
      if (cancelled) return;
      if (!athleteId || !linked.has(athleteId)) {
        setUnavailable(true);
        return;
      }
      markRead(setId);
      router.replace(threadViewHref(athleteId, setId));
    })();
    return () => {
      cancelled = true;
    };
  }, [setId, known, linkedKey, signedIn, markRead, router]);

  if (!unavailable) {
    return (
      <p role="status" className="m-0 p-4 text-ui text-muted md:p-8">
        Opening the thread…
      </p>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center p-4 md:p-8">
      <EmptyState
        title="This thread isn’t available"
        body="The set may have been deleted, or the athlete is no longer linked to you."
        action={
          <Link href="/coach/replies" className="text-ui text-accent-fill underline">
            Back to Replies
          </Link>
        }
      />
    </div>
  );
}
