"use client";

import { useEffect, useState } from "react";
import { authorLabel, type Comment } from "@/lib/review/comments";
import { fetchCommentsForAthlete } from "@/lib/review/comment-store";
import { useSession } from "@/lib/auth/session-context";

/**
 * What has been said to this athlete lately, on their Athlete View.
 *
 * The Review Queue is where feedback is written and it is organised around
 * clearing: a clip leaves the moment it is dealt with. This is the other
 * reading of the same rows -- everything said to one person, in order --
 * which is what a coach wants before writing next week's block.
 *
 * Read-only. Replying belongs with the clip, where the video and the numbers
 * are, and a second composer here would be a second place to say the same
 * thing with less context attached.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; comments: Comment[] }
  | { status: "failed" };

const when = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function RecentFeedback({ athleteId }: { athleteId: string }) {
  const { state: session } = useSession();
  const viewerId = session.status === "signed-in" ? session.user.id : "";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState({ status: "loading" });
      try {
        const comments = await fetchCommentsForAthlete(athleteId);
        if (!cancelled) setState({ status: "ready", comments });
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  if (state.status === "loading") {
    return <p className="m-0 text-ui text-muted" aria-busy>Loading feedback…</p>;
  }
  // Silent on failure rather than shouting: this is one panel on a screen, and
  // an error box where a coach expected a list is worse than a quiet absence.
  if (state.status === "failed") return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-ui font-semibold text-muted">Recent feedback</h2>
      {state.comments.length === 0 ? (
        <p className="m-0 text-ui text-muted-2">
          Nothing said yet. Comments you leave on their clips appear here.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {state.comments.map((comment) => (
            <li key={comment.id} className="rounded-control border border-border p-3">
              <p className="m-0 text-ui font-semibold text-muted">
                {authorLabel(comment, new Map(), viewerId, "Your athlete")}
                <span className="font-medium text-muted-2"> · {when(comment.createdAt)}</span>
              </p>
              <p className="m-0 whitespace-pre-wrap text-body">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
