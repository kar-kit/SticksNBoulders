"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { formatNumber } from "@/lib/logging/prefill";
import type { PrKind, SessionPr } from "@/lib/strength/pr";
import { haptic } from "@/lib/ui/haptics";

const PR_KIND_LABEL: Record<PrKind, string> = {
  e1rm: "Estimated 1RM",
  weight: "Heaviest weight",
  reps: "Rep PR",
};

/**
 * Past this many cards the stagger stops growing: the sixth record and every
 * one after it arrive together, `pr-card-in`'s step (70ms) times this after
 * the first. A big day should not make the athlete watch a queue.
 */
const STAGGER_CAP = 5;

/**
 * The records broken today, as the hero of the finish screen (F22). Joey,
 * after a session: "Make the PRs at the end of a log more animated and
 * important, maybe a different colour."
 *
 * One line per exercise per kind, rep records one per load, in sessionPrs'
 * order (lib/strength/pr.ts). The first is the headline: the exercise it
 * was on, its figure at hero size. The rest are rows under it, figures still
 * in the record colour. Nothing renders when there are none; the finish
 * screen is then exactly what it was before this existed.
 *
 * Colour: `--pr`, a gold kept for this screen alone, not the copper the
 * rows' PR pill wears (app/globals.css has the contrast ratios). Motion, all
 * behind `motion-safe:` and all transform or opacity (docs/athlete-motion.md,
 * F22): the count pill pops, each card rises in on the spring a step after
 * the one before, the headline figure pops on the bounce, and one band of
 * light crosses the card once. Every piece of it is CSS on elements that
 * mount with the screen and keep their keys, so a re-render never replays it,
 * and none of it touches the Back to Today button below.
 *
 * The section keeps the label "Personal records" it had before. The count
 * ("3 new PRs") is its first child, so it is the first thing read inside it.
 */
export function PrCelebration({
  prs,
  nameFor,
  load,
}: {
  prs: readonly SessionPr[];
  nameFor: (exerciseId: string) => string | null;
  /** A load in kilos, written in the athlete's unit ("182.5 kg"). */
  load: (kg: number) => string;
}) {
  // One buzz when the screen arrives with a record, the Log's PR idiom
  // (log-screen.tsx, the `judged` set): mark it played before playing, never
  // again for this mount. A ref rather than state so a re-render, or React's
  // development double-run of effects, cannot buzz twice. The Finish tap that
  // brought the athlete here is the user activation Android Chrome needs.
  const buzzed = useRef(false);
  const any = prs.length > 0;
  useEffect(() => {
    if (!any || buzzed.current) return;
    buzzed.current = true;
    haptic("success");
  }, [any]);

  if (!any) return null;

  const figure = (pr: SessionPr) =>
    pr.kind === "e1rm" && pr.e1rmKg !== null ? load(pr.e1rmKg) : pr.kind === "reps" ? `${pr.reps} reps` : load(pr.loadKg);
  const detail = (pr: SessionPr) =>
    `${PR_KIND_LABEL[pr.kind]} · ${load(pr.loadKg)} × ${pr.reps}${pr.rpe !== null ? ` @ ${formatNumber(pr.rpe)}` : ""}`;
  const stagger = (i: number) => ({ "--pr-index": Math.min(i, STAGGER_CAP) }) as CSSProperties;
  const [lead, ...rest] = prs;

  return (
    <section
      aria-label="Personal records"
      className="relative isolate flex flex-col gap-3 overflow-hidden rounded-card border border-pr/40 bg-pr/10 p-4"
    >
      <span
        aria-hidden
        data-pr-sweep
        className="pr-sweep-band pointer-events-none absolute inset-0 -z-10 opacity-0 motion-safe:animate-pr-sweep"
      />
      <h2 className="m-0 flex">
        <span className="inline-block rounded-chip bg-pr px-2 py-1 font-mono text-label uppercase text-on-pr motion-safe:animate-spring-pop">
          {prs.length === 1 ? "New PR" : `${prs.length} new PRs`}
        </span>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        <li
          style={stagger(0)}
          className="flex flex-col gap-1 motion-safe:pr-card-in"
        >
          <span className="text-heading font-semibold">{nameFor(lead.exerciseId) ?? lead.exerciseId}</span>
          <span
            data-pr-headline
            className="block w-fit origin-left text-hero font-bold text-pr tabular-nums motion-safe:animate-spring-pop"
          >
            {figure(lead)}
          </span>
          <span className="text-caption text-muted">{detail(lead)}</span>
        </li>
        {rest.map((pr, i) => (
          <li
            key={`${pr.exerciseId}:${pr.kind}:${pr.clientSetId}`}
            style={stagger(i + 1)}
            className="flex items-baseline justify-between gap-3 border-t border-pr/20 pt-3 motion-safe:pr-card-in"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-semibold">{nameFor(pr.exerciseId) ?? pr.exerciseId}</span>
              <span className="text-caption text-muted">{detail(pr)}</span>
            </span>
            <span className="flex-none text-value-lg font-semibold text-pr tabular-nums">{figure(pr)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
