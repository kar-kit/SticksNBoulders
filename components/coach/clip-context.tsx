"use client";

import Link from "next/link";
import { e1rmDelta, setPosition, type QueueItem } from "@/lib/review/queue";
import type { RecentSet } from "@/lib/review/queue-store";
import { adjustProgramHref } from "@/lib/coach/adjust-program";
import { formatWeight } from "@/lib/units";
import { UserAvatar } from "@/components/profile/user-avatar";

/**
 * Everything to the right of the video.
 *
 * The blueprint calls this the product, and it means it: which lift, which set,
 * what the RPE was, how it compares to recent weeks, and what the athlete said
 * about it is exactly what Joey currently types into WhatsApp by hand before
 * Ruairi can say anything useful. None of it is typed by anyone here.
 *
 * "Prescribed:" is the set's own `prescribed` snapshot, as stored when the
 * athlete logged it, and never recomputed from the program: logged work is
 * immutable, and a coach editing the line since must not change what this set
 * was asked to be. A set logged freely has no snapshot and gets no line --
 * inferring a target from what was lifted would put a number in front of a
 * coach that nobody prescribed.
 *
 * "Adjust program" is the third step of Ruairi's review day ("Watch videos,
 * analyse weaknesses and then adjust program accordingly", form answer, 6 Oct
 * 2026). It opens in a new tab on purpose: the queue holds its place, the
 * undo, a half-written comment and its Realtime subscriptions in this
 * component's state, and a same-tab navigation unmounts all of it. Closing the
 * editor tab puts the coach back on this exact clip.
 */

const dateLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

const rpeLabel = (rpe: number | null): string => (rpe === null ? "RPE —" : `RPE ${rpe}`);

export interface ClipContextProps {
  item: QueueItem;
  /** Every set in the clip's session, for the "set 3 of 4" line. */
  sessionSets: readonly { exerciseId: string; setIndex: number }[];
  recent: readonly RecentSet[];
  /** Best e1RM on this lift before this set. Null when there is no history. */
  previousBestKg: number | null;
}

export function ClipContext({ item, sessionSets, recent, previousBestKg }: ClipContextProps) {
  const { position, total } = setPosition(item, sessionSets);
  const estimate = e1rmDelta(item, previousBestKg);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="m-0 flex items-center gap-2.5 text-title font-semibold">
          <UserAvatar userId={item.athleteId} name={item.athleteName} size={28} />
          <span>
            {item.athleteName} — {item.exerciseName}
          </span>
        </h2>
        <p className="m-0 text-ui text-muted">
          {dateLabel(item.loggedAt)}, set {position} of {total}
        </p>
      </div>

      <p className="m-0 text-display font-bold tabular-nums">
        {formatWeight(item.loadKg, "kg")} × {item.reps}{" "}
        <span className="text-title font-semibold text-muted">{rpeLabel(item.rpe)}</span>
      </p>

      {item.prescribed ? (
        <p className="m-0 text-ui tabular-nums">
          <span className="text-muted">Prescribed: </span>
          <span className="font-semibold">{item.prescribed}</span>
        </p>
      ) : null}

      <Link
        href={adjustProgramHref(item.athleteId, item.prescriptionId)}
        target="_blank"
        rel="noopener"
        className="self-start text-ui text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
      >
        Adjust program<span className="sr-only"> (opens in a new tab)</span> ↗
      </Link>

      {estimate ? (
        <p className="m-0 text-ui tabular-nums">
          <span className="text-muted">e1RM </span>
          <span className="font-semibold">{formatWeight(estimate.e1rmKg, "kg")}</span>
          {estimate.deltaKg === null ? (
            <span className="text-muted"> — first on this lift</span>
          ) : (
            <span className={estimate.deltaKg >= 0 ? "text-foreground" : "text-muted"}>
              {" "}
              ({estimate.deltaKg >= 0 ? "+" : "−"}
              {formatWeight(Math.abs(estimate.deltaKg), "kg")} on their best)
            </span>
          )}
        </p>
      ) : null}

      {item.notes ? (
        <div>
          <h3 className="m-0 text-ui font-semibold text-muted">Athlete note</h3>
          <p className="m-0 text-body">“{item.notes}”</p>
        </div>
      ) : null}

      <div>
        <h3 className="m-0 mb-2 text-ui font-semibold text-muted">Last {recent.length || ""} sets of this lift</h3>
        {recent.length === 0 ? (
          <p className="m-0 text-ui text-muted-2">Nothing logged on this lift before today.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {recent.map((set, index) => (
              <li key={`${set.loggedAt}-${index}`} className="flex gap-3 text-ui tabular-nums">
                <span className="w-[86px] flex-none text-muted">{dateLabel(set.loggedAt)}</span>
                <span>
                  {formatWeight(set.loadKg, "kg")} × {set.reps}
                </span>
                <span className="text-muted">{rpeLabel(set.rpe)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
