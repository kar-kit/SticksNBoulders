"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { NoteIcon } from "@/components/ui/icons";
import { SET_NOTE_MAX, noteAnnouncement, noteCounter } from "@/lib/logging/set-note";

/**
 * The athlete's note on one set, being typed (F11).
 *
 * One textarea for both places a note is written -- the Log's edit sheet and
 * History's row edit -- so the limit, the counter and the wording are the
 * same wherever the athlete meets it.
 *
 * The counter only appears in the last hundred characters (see
 * lib/logging/set-note.ts). It is visual only; a separate polite live region
 * speaks at a few steps (`noteAnnouncement`), so a screen reader is not read
 * a number on every key. `maxLength`
 * does the actual stopping: the column is 500 and nothing past it would save.
 */
export function SetNoteField({
  value,
  onChange,
  setLabel,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** "Set 2" or "Warm-up set", for the field's accessible name. */
  setLabel: string;
  /** The edit sheet's Note cell opens straight onto the keyboard. */
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const counter = noteCounter(value);
  const announcement = noteAnnouncement(value);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-mono text-label uppercase text-muted-2">
          Note
        </label>
        <span aria-hidden="true" className="font-mono text-label tabular-nums text-muted-2">
          {counter}
        </span>
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        maxLength={SET_NOTE_MAX}
        autoFocus={autoFocus}
        aria-label={`Note on ${setLabel}`}
        placeholder="How it felt, what to watch for"
        enterKeyHint="done"
        className="min-h-[88px] w-full resize-none rounded-control border border-border bg-surface-2 px-3 py-2.5 text-body text-foreground placeholder:text-muted-2 focus:border-accent-line focus:outline-none"
      />
    </div>
  );
}

/**
 * The note on a logged set, read back (F11).
 *
 * Quiet on purpose: the athlete wrote it, and the row's numbers are still
 * what the eye is for. `full` is History, where the note is the record and
 * wraps; without it the Log shows one truncated line, enough to know a note
 * is there and which one, and a tap on the row opens the whole of it.
 */
export function SetNoteLine({ note, full = false }: { note: string; full?: boolean }) {
  return (
    // A div like the row above it: in History the row and this line sit
    // inside one button, which already wraps the row's own divs.
    <div
      data-set-note=""
      className={cn(
        "flex min-w-0 items-start gap-1.5 px-2.5 pt-[5px] text-caption text-muted",
        !full && "whitespace-nowrap",
      )}
    >
      <NoteIcon width={12} height={12} className="mt-[3px] flex-none text-muted-2" />
      <span className="sr-only">Your note: </span>
      <span className={cn("min-w-0", full ? "whitespace-pre-line break-words" : "truncate")}>{note}</span>
    </div>
  );
}
