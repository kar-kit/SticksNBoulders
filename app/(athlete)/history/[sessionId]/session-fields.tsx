"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextField } from "@/components/ui/input";
import { SESSION_NAME_MAX } from "@/appwrite/documents/write";

/**
 * Naming a session and editing its notes, from History.
 *
 * Inline rather than a sheet or a dialog: it is two fields, reached once in a
 * while, and opening in place keeps the session it is about in view. The name
 * placeholder is what the session is called without one, so leaving it blank
 * is visibly a choice rather than a gap.
 */
export function SessionFieldsForm({
  name,
  notes,
  fallbackTitle,
  onSave,
  onCancel,
}: {
  name: string | null;
  notes: string | null;
  /** The program day's label or the date: what shows when the name is blank. */
  fallbackTitle: string;
  onSave: (change: { name: string | null; notes: string | null }) => void;
  onCancel: () => void;
}) {
  const [draftName, setDraftName] = useState(name ?? "");
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const nameId = useId();
  const notesId = useId();

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      aria-label="Session details"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ name: draftName.trim() || null, notes: draftNotes.trim() || null });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={nameId}>Name</FieldLabel>
        <TextField
          id={nameId}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={fallbackTitle}
          maxLength={SESSION_NAME_MAX}
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={notesId}>Notes</FieldLabel>
        <textarea
          id={notesId}
          value={draftNotes}
          onChange={(event) => setDraftNotes(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="How it went"
          className="min-h-[88px] w-full resize-none rounded-control border border-border bg-surface-2 px-3 py-2.5 text-body text-foreground placeholder:text-muted-2 focus:border-accent-line focus:outline-none"
        />
      </div>
      <div className="flex gap-3">
        <Button type="button" block variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" block>
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * The one confirmation in History.
 *
 * Deleting a set is one tap, because it is the fix for a set that should not
 * be there. Deleting a session takes every set in it, its clips and its place
 * in the week's totals, so it asks once -- inline, in the athlete's own
 * pattern (the sign-out warning), not as a modal over a phone screen.
 */
export function DeleteSessionConfirm({
  setCount,
  busy,
  onConfirm,
  onCancel,
}: {
  setCount: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-card border border-danger-line bg-surface p-4">
      <p className="m-0 text-body">
        Delete this session and {setCount === 1 ? "its 1 set" : `all ${setCount} sets`}? Clips go with them, and
        your weekly totals are recalculated. This can&rsquo;t be undone.
      </p>
      <div className="flex gap-3">
        <Button block variant="secondary" onClick={onCancel} disabled={busy}>
          Keep it
        </Button>
        <Button block variant="danger" onClick={onConfirm} disabled={busy}>
          Delete session
        </Button>
      </div>
    </div>
  );
}
