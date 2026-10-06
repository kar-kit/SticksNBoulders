"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingDot } from "@/components/ui/sync-mark";
import { FeedbackCard, SetContext } from "@/components/feedback/feedback-card";
import { useSession } from "@/lib/auth/session-context";
import { fetchMyCoach, type MyCoach } from "@/lib/coach/link-store";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { submitComment } from "@/lib/review/comment-store";
import type { Comment } from "@/lib/review/comments";
import {
  buildFeedback,
  nextSeenAt,
  replyParentId,
  type FeedbackCard as Card,
  type FeedbackSet,
} from "@/lib/review/feedback";
import { useFeedbackBadge } from "@/lib/review/feedback-context";
import { readSeenAt } from "@/lib/review/feedback-seen";
import { fetchFeedback } from "@/lib/review/feedback-store";
import { fetchClipUrls } from "@/lib/review/queue-store";
import { pendingUploads } from "@/lib/video/pending-store";

/**
 * Coach Feedback. The athlete half of the review loop, replacing a WhatsApp
 * thread.
 *
 * Every comment sits on the set it is about, with the numbers and the clip
 * beside it, and tapping the numbers opens the set in its session. Reached
 * from Today rather than the tab bar -- four tabs, no more -- and Today's tab
 * carries the unread dot.
 *
 * Opening the screen is what marks feedback seen. The "New" marks stay for
 * this visit, because they were drawn against the watermark from before it:
 * clearing them the instant they paint would hide the very thing they point at.
 */

type Loaded = {
  status: "ready";
  comments: Comment[];
  sets: Map<string, FeedbackSet>;
  /** Undefined when the lookup failed; null when there is genuinely no coach. */
  coach: MyCoach | null | undefined;
  uploading: FeedbackSet[];
  seenAt: string | null;
  /** Card order at load, so a reply does not throw its card to the top. */
  order: string[];
};

const CLIP_BATCH = 50;

type State = { status: "loading" } | { status: "failed" } | Loaded;

/** Everything the screen needs, as one result. No React, so no stale closures. */
async function loadFeedback(viewerId: string): Promise<Loaded | { status: "failed" }> {
  // Read before anything marks it, so this visit can say what is new.
  const seenAt = readSeenAt(viewerId);
  try {
    const pending = (await pendingUploads().catch(() => []))
      .filter((upload) => upload.athleteId === viewerId)
      .map((upload) => upload.setId);

    const [{ comments, sets }, coach] = await Promise.all([
      fetchFeedback(viewerId, pending),
      fetchMyCoach().catch(() => undefined),
    ]);

    const spokenAbout = new Set(comments.map((comment) => comment.setId));
    const uploading = pending
      .filter((setId) => !spokenAbout.has(setId))
      .map((setId) => sets.get(setId))
      .filter((set): set is FeedbackSet => set !== undefined);

    const order = buildFeedback(comments, sets, viewerId, seenAt).map((card) => card.setId);
    return { status: "ready", comments, sets, coach, uploading, seenAt, order };
  } catch {
    return { status: "failed" };
  }
}

export function FeedbackScreen() {
  const router = useRouter();
  const { state: session } = useSession();
  const { state: library } = useExerciseLibrary();
  const { markSeen } = useFeedbackBadge();
  const viewerId = session.status === "signed-in" ? session.user.id : "";

  const [state, setState] = useState<State>({ status: "loading" });
  const [clipUrls, setClipUrls] = useState<Map<string, string>>(new Map());
  const retried = useRef(new Set<string>());

  const apply = useCallback(
    (next: Loaded | { status: "failed" }) => {
      setState(next);
      if (next.status !== "ready") return;
      markSeen(nextSeenAt(next.comments, viewerId, next.seenAt));

      // Clips last and off the critical path: the words are what the athlete
      // came for, and a batch of tickets is one request however many clips.
      const spokenAbout = new Set(next.comments.map((comment) => comment.setId));
      const fileIds = [...next.sets.values()]
        .filter((set) => spokenAbout.has(set.id))
        .map((set) => set.videoFileId)
        .filter((id): id is string => Boolean(id));
      // /api/clip takes at most 60 ids a request; a season of feedback can
      // name more clips than that, and one oversized batch would lose them all.
      for (let i = 0; i < fileIds.length; i += CLIP_BATCH) {
        void fetchClipUrls(fileIds.slice(i, i + CLIP_BATCH))
          .then((urls) => setClipUrls((current) => new Map([...current, ...urls])))
          .catch(() => {});
      }
    },
    [viewerId, markSeen],
  );

  useEffect(() => {
    if (!viewerId) return;
    let cancelled = false;
    void loadFeedback(viewerId).then((next) => {
      if (!cancelled) apply(next);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerId, apply]);

  const retry = () => {
    setState({ status: "loading" });
    void loadFeedback(viewerId).then(apply);
  };

  const names = useMemo(() => {
    const map = new Map<string, string>();
    if (state.status === "ready" && state.coach?.coachName) map.set(state.coach.coachId, state.coach.coachName);
    return map;
  }, [state]);

  const exerciseName = useMemo(() => {
    const byId = new Map(library.exercises.map((exercise) => [exercise.id, exercise.name]));
    return (id: string) => byId.get(id) ?? "Exercise";
  }, [library.exercises]);

  const cards = useMemo(() => {
    if (state.status !== "ready") return [];
    const built = buildFeedback(state.comments, state.sets, viewerId, state.seenAt);
    const position = new Map(state.order.map((id, index) => [id, index]));
    return built.sort(
      (a, b) => (position.get(a.setId) ?? -1) - (position.get(b.setId) ?? -1),
    );
  }, [state, viewerId]);

  const reply = useCallback(
    async (card: Card, body: string): Promise<boolean> => {
      if (!viewerId) return false;
      const outcome = await submitComment({
        athleteId: viewerId,
        setId: card.setId,
        authorId: viewerId,
        body,
        parentId: replyParentId(card),
      });
      if (!outcome.ok) return false;
      setState((current) =>
        current.status === "ready" ? { ...current, comments: [...current.comments, outcome.comment] } : current,
      );
      return true;
    },
    [viewerId],
  );

  // A ticket lasts five minutes. A clip opened after that fails once, and
  // one fresh ticket fixes it; a second failure is a real one and stays put.
  const onClipError = useCallback((fileId: string) => {
    if (retried.current.has(fileId)) return;
    retried.current.add(fileId);
    void fetchClipUrls([fileId])
      .then((fresh) => setClipUrls((current) => new Map([...current, ...fresh])))
      .catch(() => {});
  }, []);

  const coachName =
    state.status === "ready" && state.coach?.coachName ? state.coach.coachName : "your coach";

  return (
    <div className="pt-safe-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" onClick={() => router.back()} aria-label="Back">
          ← Back
        </Button>
        <h1 className="m-0 text-display font-semibold">Coach feedback</h1>
      </header>

      {state.status === "loading" ? (
        <p className="m-0 text-ui text-muted" aria-busy>
          Loading feedback…
        </p>
      ) : state.status === "failed" ? (
        <EmptyState
          title="Couldn't load your feedback"
          body="Nothing is lost. It will be here when you have signal."
          action={
            <Button variant="secondary" onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : (
        <>
          {state.uploading.length > 0 ? (
            <section aria-label="Still uploading" className="flex flex-col gap-2">
              {state.uploading.map((set) => (
                <div
                  key={set.id}
                  className="flex items-center justify-between gap-3 rounded-control border border-dashed border-border p-3"
                >
                  <SetContext set={set} exerciseName={exerciseName(set.exerciseId)} />
                  <span className="flex flex-none items-center gap-2 text-ui text-muted">
                    <PendingDot />
                    Uploading — {coachName} can&apos;t see it yet
                  </span>
                </div>
              ))}
            </section>
          ) : null}

          {cards.length === 0 ? (
            <Empty coach={state.coach} />
          ) : (
            <>
              {state.coach === null ? (
                <p className="m-0 text-ui text-muted">
                  You&apos;re not linked to a coach any more, so replies are off. What they said stays here.
                </p>
              ) : null}
              <div className="flex flex-col gap-3">
                {cards.map((card) => (
                  <FeedbackCard
                    key={card.setId}
                    card={card}
                    exerciseName={card.set ? exerciseName(card.set.exerciseId) : ""}
                    clipUrl={card.set?.videoFileId ? (clipUrls.get(card.set.videoFileId) ?? null) : null}
                    names={names}
                    viewerId={viewerId}
                    seenAt={state.seenAt}
                    canReply={state.coach !== null}
                    onReply={reply}
                    onClipError={onClipError}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Empty({ coach }: { coach: MyCoach | null | undefined }) {
  if (coach === null) {
    // Today hides the way in for a solo athlete, so this is only reached by
    // URL -- but a real answer beats a blank page for whoever finds it.
    return (
      <EmptyState
        title="No coach linked"
        body="When a coach reviews your filmed sets, what they say lands here. Link one with their invite code."
        action={
          <Link href="/me" className="text-ui font-semibold text-accent-fill underline underline-offset-4">
            Add a coach in Me
          </Link>
        }
      />
    );
  }
  const name = coach?.coachName || "your coach";
  return (
    <EmptyState
      title={`Nothing from ${coach?.coachName || "your coach"} yet`}
      body={`Film a set and ${name} will see it.`}
    />
  );
}
