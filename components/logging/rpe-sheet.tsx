"use client";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/logging/prefill";
import type { RpeValue } from "@/lib/logging/set";

/**
 * RPE entry. Half points from 6 to 10 is eleven values, which a number pad
 * handles badly, so this is large chips in one sheet with no scrolling.
 *
 * "Not sure" is deliberate and records a null. Ruairi's own point was that RPE
 * is unreliable; a forced guess pollutes the personal curve worse than a null
 * does, so the uncertainty is recorded rather than papered over.
 */

const WHOLE_ROW: RpeValue[] = [6, 6.5, 7, 7.5, 8, 8.5];
const LAST_ROW: RpeValue[] = [9, 9.5, 10];

export interface RpeSheetProps {
  /** Titles the sheet, e.g. 1 renders "RPE · SET 1". */
  setIndex: number;
  value: RpeValue | null;
  /** Null means the athlete chose "Not sure". */
  onSelect: (value: RpeValue | null) => void;
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

export function RpeSheet({ setIndex, value, onSelect }: RpeSheetProps) {
  const isHalf = (v: RpeValue) => !Number.isInteger(v);

  return (
    <section
      aria-label={`RPE for set ${setIndex}`}
      className="flex flex-none flex-col gap-3 border-t border-border bg-surface px-3 pt-3.5 pb-[22px]"
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

      <div className="grid grid-cols-[1fr_1fr_1fr_3fr] gap-2">
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
          aria-pressed={value === null}
          onClick={() => onSelect(null)}
          className={cn(
            "flex h-14 items-center justify-center rounded-control border text-body font-medium",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
            value === null
              ? "border-accent-line bg-surface-2 text-foreground"
              : "border-border bg-background text-muted",
          )}
        >
          Not sure
        </button>
      </div>
    </section>
  );
}
