"use client";

import { clipSummary, type ClipItem } from "@/lib/programming/clipboard";

/**
 * What the editor's clipboard holds, under the program header: the day or
 * week, where it came from, and an × to let it go. F28.
 *
 * Only shown while something is held, so a coach who never copies never sees
 * it. When the program on screen is another athlete's than the copy's, it
 * says so before the paste: the lines go across as typed, so "75%" becomes
 * 75% of THIS athlete's max. That is the point of pasting a percentage, but
 * it is the one thing about a paste that changes a number. [Inference]
 */
export function ClipboardBar({
  item,
  crossNote,
  onClear,
}: {
  item: ClipItem;
  /** One line, when pasting here resolves against someone else's maxes than the source's. */
  crossNote: string | null;
  onClear: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Clipboard"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-border bg-surface-2 py-1.5 pr-1.5 pl-3 text-ui motion-safe:animate-rise-in"
    >
      <span className="font-mono text-label text-muted-2 uppercase">{item.kind === "day" ? "Day copied" : "Week copied"}</span>
      <span className="min-w-0 flex-1 truncate">
        {clipSummary(item)} <span className="text-muted">· {item.programName}</span>
      </span>
      <button
        type="button"
        aria-label="Clear clipboard"
        title="Clear clipboard"
        onClick={onClear}
        className="grid size-10 flex-none place-items-center rounded-chip text-muted transition-control press hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-accent-line md:size-7"
      >
        ×
      </button>
      {crossNote ? <p className="m-0 w-full text-caption text-muted">{crossNote}</p> : null}
    </div>
  );
}
