"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatDots,
  formatTotalBreakdown,
  LIFT_LABELS,
  type CompetitionLift,
  type DotsResult,
} from "@/lib/strength/dots";
import { fetchDots } from "@/lib/strength/dots-store";
import { useUnits } from "@/lib/profile/units-context";
import { loadIn } from "@/lib/units";

/**
 * The DOTS figure, on both screens.
 *
 * One component rather than one per surface, because it is one number and two
 * copies of the assembly could disagree about it. What genuinely differs is
 * the words when there is no number: the athlete can fix every cause
 * themselves and gets a link, the coach can fix none of them and gets a
 * statement of what he is waiting on. That is the only thing `audience`
 * changes.
 *
 * It is a personal progression number and nothing else -- no rank, no
 * percentile, nobody else's score anywhere near it. CLAUDE.md puts
 * leaderboards, groups and friend competition in the final phase and says not
 * to scaffold for them, so nothing here is shaped to make one cheap later.
 */

type State = { status: "loading" } | { status: "loaded"; result: DotsResult } | { status: "failed" };

export interface DotsBlockProps {
  athleteId: string;
  audience: "athlete" | "coach";
}

const liftList = (lifts: readonly CompetitionLift[]): string =>
  lifts.map((lift) => LIFT_LABELS[lift].toLowerCase()).join(", ");

export function DotsBlock({ athleteId, audience }: DotsBlockProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  // The coach side has no units provider, so a coach reads kilos.
  const { unit } = useUnits();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState({ status: "loading" });
      try {
        const result = await fetchDots(athleteId);
        if (!cancelled) setState({ status: "loaded", result });
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  if (state.status === "loading") {
    return (
      <section className="flex flex-col gap-1">
        <Label />
        <p className="m-0 text-ui text-muted" aria-busy>
          Loading…
        </p>
      </section>
    );
  }

  // Quiet on a failed read. DOTS is a secondary figure on both screens, and an
  // error box where a number was expected is worse than the number's absence.
  if (state.status === "failed") return null;

  const { result } = state;

  if (result.status === "ready") {
    return (
      <section className="flex flex-col gap-1">
        <Label />
        <p className="m-0 text-display font-bold tabular-nums">{formatDots(result.score)}</p>
        <p className="m-0 text-ui text-muted tabular-nums">
          from {formatTotalBreakdown(result.lifts, unit)}
          {result.stale ? (
            // The bodyweight behind it is older than the averaging window.
            // Said rather than hidden: the coach's panel exists so he stops
            // having to ask, and an unlabelled figure would read as current.
            <span className="text-muted-2">
              {" "}
              · at {loadIn(result.bodyweightKg, unit).toFixed(1)}
              {unit} from {dayLabel(result.measuredOn)}
            </span>
          ) : null}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1">
      <Label />
      <p className="m-0 text-ui text-muted">
        {audience === "coach" ? coachDotsWaiting(result) : null}

        {audience === "athlete" && result.status === "no-sex" ? (
          <>
            <Link href="/me" className="underline">
              Add your sex on Profile
            </Link>{" "}
            and this appears. The two formulas differ and there is no sensible default.
          </>
        ) : null}

        {audience === "athlete" && result.status === "no-bodyweight" ? "Log a weight and this appears." : null}

        {audience === "athlete" && result.status === "incomplete-total"
          ? `Needs a number on ${liftList(result.missing)}. Log a top single, or ask your coach to set a tested max.`
          : null}
      </p>
    </section>
  );
}

/**
 * What the coach is told when there is no DOTS yet. Exported so the Athlete
 * View's maxes table, which now carries DOTS as a row, says the same sentence
 * this block does -- one wording per cause, whichever surface draws it.
 */
export function coachDotsWaiting(result: Exclude<DotsResult, { status: "ready" }>): string {
  switch (result.status) {
    case "no-sex":
      return "Waiting on their sex, which is set on their own Profile screen.";
    case "no-bodyweight":
      return "Waiting on a weigh-in.";
    case "incomplete-total":
      return `Waiting on ${liftList(result.missing)} — no tested max and nothing logged yet.`;
  }
}

function Label() {
  return <h2 className="m-0 text-label uppercase tracking-wide text-muted">DOTS</h2>;
}

const dayLabel = (key: string): string => {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
};
