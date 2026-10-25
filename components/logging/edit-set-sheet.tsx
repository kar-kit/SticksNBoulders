"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/logging/prefill";
import type { EditDraft } from "@/lib/logging/logged-edit";
import type { PadState } from "@/lib/logging/number-pad";
import type { RpeValue } from "@/lib/logging/set";
import { loadNumber, unitName, type UnitPreference } from "@/lib/units";
import { NoteIcon } from "@/components/ui/icons";
import { NumberPad } from "./number-pad";
import { RpeSheet } from "./rpe-sheet";
import { SetNoteField } from "./set-note-field";

/**
 * Correcting a logged set, in the Log's sheet (F9).
 *
 * The same keypad and the same RPE chips as logging a set, because an edit is
 * the same gesture as an entry -- but dressed so it cannot be taken for one.
 * Logging is the thing an athlete does forty times a session without looking;
 * if the sheet that rewrites set 2 looked like the sheet that logs set 5, a
 * thumb on autopilot would change the wrong set and never know. So:
 *
 * - A title bar, which the logging pad has never had: "Edit set 2" and the
 *   exercise, with Cancel and Save either side of it in the iOS sheet
 *   positions. Save, not a confirm square -- nothing is being logged.
 * - The three values side by side above the pad, as the draft stands, so
 *   the whole correction is in view and any field is one tap away. The row
 *   in the list keeps the logged numbers until Save; this strip is where the
 *   new ones show.
 * - No Done on the pad. Cancel and Save are the two ways out, and they mean
 *   exactly what they say.
 *
 * The note (F11) is the fourth field, under the three values: one full-width
 * cell showing the note as it stands or "Add a note", which swaps the pad for
 * a textarea. It is here rather than on the row because this sheet is
 * already one tap from any logged set, including the one just logged, and a
 * note is a correction's sibling: something about the set, said afterwards.
 * Blank and Save clears it.
 *
 * Delete set lives here too. Tapping a logged row used to open a strip with
 * Delete and Keep; tapping it now opens this, so the non-gesture path to a
 * delete (for a screen reader, a keyboard, or anyone who never swipes) moves
 * in with it rather than disappearing.
 *
 * The set's clip (F17) is here as well: Add video on a set with none, Replace
 * video on one that has one. It is the Log's own camera (`AttachVideo`),
 * passed in by the screen, so it uploads, captures the poster and queues the
 * attach exactly as the camera under the block does. A clip is not part of
 * the draft: it goes up the moment it is picked, and Cancel does not take it
 * back, which the line beside it says.
 *
 * Presentational: the screen owns the draft and every write.
 */

export type EditField = "load" | "reps" | "rpe" | "note";

export interface EditSetSheetProps {
  /** "Set 2", or "Warm-up set": the row's own label, as the list numbers it. */
  setLabel: string;
  exerciseName: string;
  draft: EditDraft;
  field: EditField;
  /** The pad for the load or reps field; ignored while `field` is "rpe". */
  pad: PadState | null;
  unit: UnitPreference;
  /** Save is offered only for a draft that is a set: a load and reps above zero. */
  canSave: boolean;
  onField: (field: EditField) => void;
  onPadChange: (next: PadState) => void;
  onToggleWarmup: (isWarmup: boolean) => void;
  onRpe: (value: RpeValue | null) => void;
  /** A key in the note's textarea: the draft's note as typed. */
  onNote: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  /** Why this set cannot be deleted, shown in place of Delete. */
  deleteBlocked?: string | null;
  /** Delete held back for a moment: a clip for this set is uploading. */
  deleteDisabled?: boolean;
  /** The set's camera (F17): an `AttachVideo` for this set. */
  video?: ReactNode;
}

export function EditSetSheet({
  setLabel,
  exerciseName,
  draft,
  field,
  pad,
  unit,
  canSave,
  onField,
  onPadChange,
  onToggleWarmup,
  onRpe,
  onNote,
  onSave,
  onCancel,
  onDelete,
  deleteBlocked = null,
  deleteDisabled = false,
  video = null,
}: EditSetSheetProps) {
  const title = setLabel === "Warm-up set" ? "Edit warm-up" : `Edit ${setLabel.toLowerCase()}`;
  const showPad = (field === "load" || field === "reps") && pad !== null;
  const note = draft.notes.trim();
  // The RPE sheet titles itself by number; a warm-up never reaches it.
  const rpeNumber = Number(setLabel.replace(/\D+/g, "")) || 1;

  const cells: { field: EditField; label: string; value: string; spoken: string; disabled?: boolean }[] = [
    {
      field: "load",
      label: unit.toUpperCase(),
      value: draft.loadKg === null ? "—" : loadNumber(draft.loadKg, unit),
      spoken: draft.loadKg === null ? "empty" : `${loadNumber(draft.loadKg, unit)} ${unitName(unit)}`,
    },
    {
      field: "reps",
      label: "REPS",
      value: draft.reps === null ? "—" : String(draft.reps),
      spoken: draft.reps === null ? "empty" : String(draft.reps),
    },
    {
      field: "rpe",
      label: "RPE",
      // A warm-up is never asked, and is saved without one.
      value: draft.isWarmup || draft.rpe === null ? "—" : formatNumber(draft.rpe),
      spoken: draft.isWarmup ? "none, warm-up" : draft.rpe === null ? "not sure" : formatNumber(draft.rpe),
      disabled: draft.isWarmup,
    },
  ];
  const fieldWord: Record<EditField, string> = { load: "weight", reps: "reps", rpe: "RPE", note: "note" };

  return (
    <section aria-label={`Edit ${setLabel}`} data-edit-sheet="" className="flex flex-none flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button variant="ghost" onClick={onCancel} aria-label={`Cancel, keep ${setLabel} as logged`}>
          Cancel
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center text-center">
          <h2 className="m-0 text-body font-semibold text-foreground">{title}</h2>
          <span className="max-w-full truncate font-mono text-label uppercase text-muted-2">
            {exerciseName} · logged
          </span>
        </div>
        <Button onClick={onSave} disabled={!canSave} aria-label={`Save ${setLabel}`}>
          Save
        </Button>
      </header>

      <div role="group" aria-label="Values being saved" className="grid grid-cols-3 gap-2 px-3 pt-3">
        {cells.map((cell) => (
          <button
            key={cell.field}
            type="button"
            disabled={cell.disabled}
            aria-pressed={field === cell.field}
            aria-label={`Change ${fieldWord[cell.field]}, now ${cell.spoken}`}
            onClick={() => onField(cell.field)}
            className={cn(
              "flex h-12 flex-col items-center justify-center rounded-control border",
              field === cell.field ? "border-accent-line bg-surface-2" : "border-border bg-surface",
              "disabled:text-muted-2",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
            )}
          >
            <span className="font-mono text-label-xs text-muted-2">{cell.label}</span>
            <span className="text-value-sm font-semibold tabular-nums text-foreground">{cell.value}</span>
          </button>
        ))}
      </div>

      <div className="px-3 pt-2">
        <button
          type="button"
          aria-pressed={field === "note"}
          aria-label={note ? `Change note, now: ${note}` : `Add a note to ${setLabel}`}
          onClick={() => onField("note")}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-control border px-3 text-left text-caption",
            field === "note" ? "border-accent-line bg-surface-2" : "border-border bg-surface",
            note ? "text-foreground" : "text-muted",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
          )}
        >
          <NoteIcon width={14} height={14} className="flex-none text-muted-2" />
          <span className="min-w-0 truncate">{note || "Add a note"}</span>
        </button>
      </div>

      {field === "note" ? (
        <SetNoteField
          className="px-3 pt-3 pb-2"
          value={draft.notes}
          onChange={onNote}
          setLabel={setLabel}
          autoFocus
        />
      ) : showPad ? (
        <NumberPad
          inSheet
          state={pad}
          onChange={onPadChange}
          onNext={() => (pad.field === "load" ? onField("reps") : draft.isWarmup ? onSave() : onField("rpe"))}
          nextLabel={pad.field === "load" ? "Reps" : draft.isWarmup ? "Save" : "RPE"}
          isWarmup={draft.isWarmup}
          onToggleWarmup={onToggleWarmup}
        />
      ) : (
        <RpeSheet inSheet setIndex={rpeNumber} value={draft.rpe} onSelect={onRpe} />
      )}

      {video ? (
        <div role="group" aria-label="Video" className="flex items-center justify-between gap-3 px-3 pt-1 pb-2">
          <p className="m-0 flex min-w-0 flex-col text-caption">
            <span className="font-mono text-label-xs text-muted-2">VIDEO</span>
            <span className="text-muted">Goes up straight away, not on Save.</span>
          </p>
          {video}
        </div>
      ) : null}

      <div className="flex items-center justify-center px-3 pb-3">
        {deleteBlocked ? (
          <p className="m-0 text-center text-caption text-muted">{deleteBlocked}</p>
        ) : onDelete ? (
          <Button variant="danger" onClick={onDelete} disabled={deleteDisabled} aria-label={`Delete ${setLabel}`}>
            Delete set
          </Button>
        ) : null}
      </div>
    </section>
  );
}
