"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { afterExit, usePresence } from "@/components/ui/motion";
import { haptic, type HapticKind } from "@/lib/ui/haptics";
import { Caption, Panel, Rule } from "./section";

/**
 * The athlete's motion base (docs/athlete-motion.md), each piece played on
 * demand. Not a feature: the keypad sheet, the logged-set tick and the PR
 * badge are built on these later. Wrapped in `athlete-motion` so the shared
 * Button presses as it does in the athlete shell and the reduced-motion floor
 * applies.
 */
export function AthleteMotionPanel() {
  const [sheet, setSheet] = useState(false);
  const [rows, setRows] = useState(["Squat 5 × 140"]);
  const [tick, setTick] = useState(0);
  const [pop, setPop] = useState(0);

  return (
    <Panel label="Motion — athlete">
      <div className="athlete-motion flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="lg">Press and hold</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Delete set</Button>
        </div>
        <Caption>tap · 0.97 in at press (90ms), out on the spring (488ms)</Caption>

        <Rule />
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" onClick={() => setSheet((open) => !open)}>
            {sheet ? "Close sheet" : "Open sheet"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setRows((list) => [...list, `Set ${list.length + 1} planned`])}
          >
            Add row
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setTick((n) => n + 1);
              haptic("success");
            }}
          >
            Log set
          </Button>
          <Button variant="secondary" onClick={() => setPop((n) => n + 1)}>
            PR
          </Button>
        </div>

        <PhoneFrame open={sheet} rows={rows} tick={tick} pop={pop} onClose={() => setSheet(false)} />
        <Caption>
          sheet-in 439ms on the sheet spring · sheet-out 240ms ease-in · row-in on the spring ·
          tick-in and spring-pop on the bounce
        </Caption>

        <Rule />
        <div className="flex flex-wrap items-center gap-2.5">
          {(["light", "medium", "success", "warning", "alert"] as HapticKind[]).map((kind) => (
            <Button key={kind} variant="ghost" size="sm" onClick={() => haptic(kind)}>
              {kind}
            </Button>
          ))}
        </div>
        <Caption>haptic(kind) · Android vibrates; iPhone has no API and stays silent</Caption>
      </div>
    </Panel>
  );
}

function PhoneFrame({
  open,
  rows,
  tick,
  pop,
  onClose,
}: {
  open: boolean;
  rows: string[];
  tick: number;
  pop: number;
  onClose: () => void;
}) {
  const presence = usePresence(open || null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const { leaving, exited } = presence;

  // Unmount once the exit has played: at once under reduced motion, where
  // the animation is gated off and there is nothing to wait for.
  useEffect(() => {
    if (!leaving) return;
    return afterExit(sheetRef.current, exited);
    // `exited` is a fresh closure each render; the exit starts once per leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  return (
    <div className="relative h-[260px] overflow-hidden rounded-card border border-border bg-background p-3">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((row, i) => (
          <li
            key={row}
            // The first row was there when the panel opened; only added ones arrive.
            className={
              "flex h-10 items-center justify-between rounded-row bg-surface px-3 text-ui" +
              (i > 0 ? " motion-safe:animate-row-in" : "")
            }
          >
            {row}
            {i === 0 && tick > 0 ? (
              <span key={tick} aria-label="Logged" className="text-success motion-safe:animate-tick-in">
                ✓
              </span>
            ) : null}
            {i === 0 && pop > 0 ? (
              <span
                key={`pr-${pop}`}
                className="rounded-chip bg-accent-fill px-1.5 font-mono text-label-xs text-on-accent motion-safe:animate-spring-pop"
              >
                PR
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {presence.shown ? (
        <>
          <div
            aria-hidden
            onClick={onClose}
            className={
              "absolute inset-0 bg-background/60 " +
              (leaving ? "motion-safe:animate-fade-out" : "motion-safe:animate-fade-in")
            }
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-label="Demo sheet"
            inert={leaving}
            className={
              "absolute inset-x-0 bottom-0 flex h-[160px] flex-col gap-2 rounded-t-card border-t border-border bg-surface p-4 " +
              (leaving ? "motion-safe:animate-sheet-out" : "motion-safe:animate-sheet-in")
            }
          >
            <span className="mx-auto h-1 w-9 rounded-full bg-border" />
            <span className="text-ui">The keypad will live here.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
