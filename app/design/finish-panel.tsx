"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FinishedSummary } from "@/components/logging/finished-summary";
import type { SessionSummary } from "@/lib/logging/session";
import type { SessionPr } from "@/lib/strength/pr";
import { Caption, Panel } from "./section";

/**
 * F22's finish screen, the real `FinishedSummary`, in a 390 × 852 frame:
 * with no records (which must look as it always did), one, and a big day.
 * Replay remounts it, the only way it ever plays twice. Wrapped in
 * `athlete-motion` so the reduced-motion floor applies as it does in the
 * shell; on Android each mount with a record buzzes `success`, as the real
 * screen does.
 */

const NAMES: Record<string, string> = {
  squat: "Squat",
  bench: "Bench Press",
  deadlift: "Deadlift",
};

const SUMMARY: SessionSummary = {
  setCount: 18,
  tonnageKg: 9842.5,
  exerciseCount: 3,
  warmupCount: 7,
};

const pr = (exerciseId: string, kind: SessionPr["kind"], loadKg: number, reps: number, rpe: number | null, e1rmKg: number | null = null): SessionPr => ({
  exerciseId,
  kind,
  clientSetId: `${exerciseId}-${kind}-${loadKg}-${reps}`,
  loadKg,
  reps,
  rpe,
  e1rmKg,
});

const CASES = {
  none: [],
  one: [pr("squat", "weight", 182.5, 1, 9)],
  several: [
    pr("squat", "e1rm", 175, 3, 8, 193.4),
    pr("squat", "weight", 182.5, 1, 9),
    pr("bench", "reps", 100, 8, 9),
    pr("deadlift", "weight", 230, 1, 9.5),
  ],
} satisfies Record<string, SessionPr[]>;

type Case = keyof typeof CASES;

const LABEL: Record<Case, string> = { none: "No PRs", one: "1 PR", several: "4 PRs" };

export function FinishPanel() {
  const [shown, setShown] = useState<Case>("several");
  const [play, setPlay] = useState(0);

  return (
    <Panel label="Finish screen — PRs" width={438}>
      <div className="flex flex-wrap items-center gap-2.5">
        {(Object.keys(CASES) as Case[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={shown === key ? "primary" : "secondary"}
            aria-pressed={shown === key}
            onClick={() => {
              setShown(key);
              setPlay((n) => n + 1);
            }}
          >
            {LABEL[key]}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setPlay((n) => n + 1)}>
          Replay
        </Button>
      </div>
      <div
        data-shot="finish-frame"
        className="athlete-motion flex h-[852px] w-[390px] flex-col overflow-y-auto rounded-card border border-border bg-background px-4"
      >
        <FinishedSummary
          key={`${shown}-${play}`}
          summary={SUMMARY}
          prs={CASES[shown]}
          nameFor={(id) => NAMES[id] ?? null}
          unit="kg"
          onDone={() => {}}
        />
      </div>
      <Caption>
        --pr #e8b84a · count pill spring-pop · cards row-in, 70ms apart (capped at 5) · headline
        figure spring-pop · one pr-sweep, 900ms after 240ms · haptic(&quot;success&quot;) once per
        mount · reduced motion: all instant
      </Caption>
    </Panel>
  );
}
