import { Button } from "./button";

/**
 * "Set 2 deleted · Undo".
 *
 * The alternative to a confirm dialog on a screen touched forty times a
 * session. A dialog taxes every deliberate delete to protect against the rare
 * wrong one; this costs nothing on the right tap and one tap to reverse the
 * wrong one. The caller holds the timer and does the real work only when it
 * runs out, so Undo never has to un-write anything.
 *
 * `role="status"` so a screen reader announces it without moving focus off
 * the row the athlete was on.
 */
export interface UndoToastProps {
  message: string;
  onUndo: () => void;
}

export function UndoToast({ message, onUndo }: UndoToastProps) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-2 py-1.5 pr-1.5 pl-4"
    >
      <span className="text-body">{message}</span>
      <Button variant="secondary" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}
