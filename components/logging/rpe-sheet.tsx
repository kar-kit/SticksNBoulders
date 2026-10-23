"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/logging/prefill";
import { UNDER_SIX_RPE_VALUES, type RpeValue } from "@/lib/logging/set";

/**
 * RPE entry. Half points from 6 to 10 is eleven values, which a number pad
 * handles badly, so this is large chips in one sheet with no scrolling.
 *
 * "Not sure" is deliberate and records a null. Ruairi's own point was that RPE
 * is unreliable; a forced guess pollutes the personal curve worse than a null
 * does, so the uncertainty is recorded rather than papered over.
 *
 * ## Under 6
 *
 * Sets that were too easy to call a 6 (F10, Joey: "Need a sub RPE 6 sub menu
 * for the sets that are too easy"). Before this, the honest answer to an easy
 * back-off was "Not sure", which it was not, or 6, which overstated it. The
 * chip opens a row of 5, 4 and 3 in place rather than adding three chips to
 * the grid: the main grid is where nearly every working set lands and keeps
 * its one-tap layout, and the sub-menu costs one extra tap only on the sets
 * that need it.
 *
 * It opens on its own when the set already carries a sub-6 answer, so
 * re-opening the sheet on such a set shows the answer pressed rather than
 * hiding it behind a chip. Opening it records nothing: only a value does, so
 * tapping "Under 6" and backing out leaves the set's RPE as it was.
 *
 * Sub-6 is an answer and not a number to compute from: such a set gets no
 * e1RM and no e1RM record (lib/strength/e1rm.ts, `MIN_ESTIMABLE_RPE`), and a
 * coach can never prescribe it (`PrescribableRpe`). Nothing on this sheet says
 * so, because nothing the athlete would do differently follows from it.
 */

const WHOLE_ROW: RpeValue[] = [6, 6.5, 7, 7.5, 8, 8.5];
const LAST_ROW: RpeValue[] = [9, 9.5, 10];

const isUnderSix = (value: RpeValue | null): boolean => value !== null && value < 6;

export interface RpeSheetProps {
  /** Titles the sheet, e.g. 1 renders "RPE · SET 1". */
  setIndex: number;
  value: RpeValue | null;
  /** Null means the athlete chose "Not sure". */
  onSelect: (value: RpeValue | null) => void;
  /** Drawn inside a sheet that owns the edge and the fill (LogSheet). */
  inSheet?: boolean;
}

function chipClasses(selected: boolean, half: boolean) {
  return cn(
    "flex h-14 items-center justify-center rounded-control font-semibold",
    // Halves get a smaller size so "6.5" and "6" optically match in width.
    half ? "text-title" : "text-value-sm",
    selected ? "bg-accent-fill font-bold text-on-accent" : "bg-surface-2 text-foreground",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
  );
}

/** The two word chips, "Under 6" and "Not sure": outlined, so they read as answers about the set rather than numbers. */
function wordChipClasses(active: boolean) {
  return cn(
    "flex h-14 items-center justify-center rounded-control border text-body font-medium",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
    active ? "border-accent-line bg-surface-2 text-foreground" : "border-border bg-background text-muted",
  );
}

export function RpeSheet({ setIndex, value, onSelect, inSheet = false }: RpeSheetProps) {
  const isHalf = (v: RpeValue) => !Number.isInteger(v);
  // Seeded from the value, not synced to it: the sheet is mounted per opening,
  // and once open the athlete's own taps decide whether the row shows.
  const [underSixOpen, setUnderSixOpen] = useState(() => isUnderSix(value));
  const underSixId = `rpe-under-six-${setIndex}`;

  return (
    <section
      aria-label={`RPE for set ${setIndex}`}
      className={cn(
        "flex flex-none flex-col gap-3 px-3 pt-3.5 pb-[22px]",
        !inSheet && "border-t border-border bg-surface",
      )}
    >
      <div className="flex items-center justify-between px-1 font-mono text-label text-muted-2">
        <span>RPE · SET {setIndex}</span>
        <span>OPTIONAL</span>
      </div>

      <div className="grid grid-cols-6 gap-2">
        {WHOLE_ROW.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onSelect(v)}
            className={chipClasses(value === v, isHalf(v))}
          >
            {formatNumber(v)}
          </button>
        ))}
      </div>

      {/* 9, 9.5 and 10 keep the width of the chips above, so the scale reads
          as one grid; the two word chips share what is left. */}
      <div className="grid grid-cols-[1fr_1fr_1fr_1.5fr_1.5fr] gap-2">
        {LAST_ROW.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onSelect(v)}
            className={chipClasses(value === v, isHalf(v))}
          >
            {formatNumber(v)}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={underSixOpen}
          aria-controls={underSixId}
          onClick={() => setUnderSixOpen((open) => !open)}
          className={wordChipClasses(underSixOpen || isUnderSix(value))}
        >
          Under 6
        </button>
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => onSelect(null)}
          className={wordChipClasses(value === null)}
        >
          Not sure
        </button>
      </div>

      {underSixOpen ? (
        <div id={underSixId} role="group" aria-label="RPE under 6" className="grid grid-cols-3 gap-2">
          {UNDER_SIX_RPE_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={value === v}
              onClick={() => onSelect(v)}
              className={chipClasses(value === v, false)}
            >
              {formatNumber(v)}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
