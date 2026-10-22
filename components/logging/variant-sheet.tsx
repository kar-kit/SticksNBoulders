"use client";

import { cn } from "@/lib/cn";
import { haptic } from "@/lib/ui/haptics";

/**
 * Swap variant: the same movement on another implement, picked in the Log
 * screen's bottom sheet (the LogSheet that holds the pad and the RPE chips).
 *
 * One tap per option, large rows, no search -- the list is siblings of one
 * movement, a handful at most (lib/exercises/variants.ts). The coach's pick
 * comes first and says so, whether or not the coach meant the implement to
 * be fixed: the app cannot tell, so it never hides the choice, and never
 * lets the athlete lose track of what was written.
 */

export interface VariantOption {
  id: string;
  name: string;
}

export interface VariantSheetProps {
  /** The block, for the title: "Swap Barbell Row". */
  name: string;
  /** Coach's pick (or the block's own exercise) first, then its siblings. */
  options: readonly VariantOption[];
  /** The exercise the block is on now. */
  currentId: string;
  /** The coach's prescribed exercise, labelled as such. Null for a free block. */
  coachId: string | null;
  onPick: (exerciseId: string) => void;
  onCancel: () => void;
}

export function VariantSheet({ name, options, currentId, coachId, onPick, onCancel }: VariantSheetProps) {
  return (
    <section aria-label={`Swap variant of ${name}`} className="flex flex-none flex-col gap-2 px-3 pt-3.5 pb-[22px]">
      <div className="flex items-center justify-between px-1 font-mono text-label text-muted-2">
        <span>SWAP VARIANT</span>
        <span>UNLOGGED SETS ONLY</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {options.map((option) => {
          const current = option.id === currentId;
          return (
            <li key={option.id}>
              <button
                type="button"
                aria-pressed={current}
                onClick={() => {
                  haptic("light");
                  onPick(option.id);
                }}
                className={cn(
                  "flex h-14 w-full items-center justify-between gap-3 rounded-control px-4 text-left text-body font-medium tap",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                  current ? "border border-accent-line bg-surface-2 text-foreground" : "bg-surface-2 text-foreground",
                )}
              >
                <span>{option.name}</span>
                {option.id === coachId ? (
                  <span className="font-mono text-label uppercase text-muted-2">Coach&rsquo;s pick</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-11 items-center justify-center text-action text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
      >
        Cancel
      </button>
    </section>
  );
}
