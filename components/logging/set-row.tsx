"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CameraIcon } from "@/components/ui/icons";
import { PendingDot, UploadBar } from "@/components/ui/sync-mark";
import { LoadCell } from "./load-cell";
import { canComplete, completionBlocker, type LoggableSet } from "@/lib/logging/set";
import { formatNumber } from "@/lib/logging/prefill";

/**
 * The set row. An athlete touches this 20 to 40 times a session, one-handed.
 * Everything else in the product can be mediocre and it survives; this cannot.
 *
 * The fifth column is the confirm target, never the camera. Video attaches from
 * one camera button per exercise and lands on the most recently logged set of
 * that exercise -- decided 13 Sep 2026, see the Set Row blueprint. The only
 * time a camera appears inside the row is the video-required state, where it
 * takes the RPE cell until a clip exists or Skip is tapped.
 *
 * Confirm is 56px, larger than its 48px neighbours, because it is the one
 * target that must be hit first time without looking.
 */

const GRID = "26px 1fr 58px 58px var(--set-row-last)";

/**
 * How far a logged row has to travel left before letting go deletes it.
 *
 * A quarter of a 390pt screen. Far enough that a thumb scrolling the list at
 * an angle never trips it, near enough to do one-handed.
 */
export const SWIPE_DELETE_PX = 96;
/** Movement before a press counts as a drag rather than a tap. */
const DRAG_SLOP_PX = 10;

export interface SetRowProps {
  /** Set number, or "W" for a warm-up. */
  index: number | "W";
  set: LoggableSet;
  /**
   * Logged rows are read-only. The active row is the one the confirm square
   * logs. A planned row is a set written down for later -- editable, waiting
   * behind the active row, and removable instead of confirmable.
   */
  state: "logged" | "active" | "planned";
  /** Queued locally, not yet synced. Shows a quiet dot, never an error. */
  pendingSync?: boolean;
  /** 0-100 while a clip uploads. The set is already logged; this is incidental. */
  uploadPercent?: number | null;
  onPressLoad?: () => void;
  onPressReps?: () => void;
  onPressRpe?: () => void;
  onConfirm?: () => void;
  onFilm?: () => void;
  /** Explains a non-athlete-entered load: "suggested from RPE 7 @ 142.5". */
  note?: string | null;
  /** The pad is editing this row. Only one row on the screen ever is. */
  focused?: boolean;
  /** Planned rows only: drop it before it is done. */
  onDiscard?: () => void;
  /**
   * Logged rows only. Tapping the row opens its actions; swiping it left
   * deletes it straight away. Both end in the screen's undo toast, so neither
   * asks "are you sure?" first.
   */
  onSelect?: () => void;
  selected?: boolean;
  onDelete?: () => void;
  /** Why this logged set cannot be deleted, shown in place of the button. */
  deleteBlocked?: string | null;
}

export function SetRow({
  index,
  set,
  state,
  pendingSync = false,
  uploadPercent = null,
  onPressLoad,
  onPressReps,
  onPressRpe,
  onConfirm,
  onFilm,
  note,
  focused = false,
  onDiscard,
  onSelect,
  selected = false,
  onDelete,
  deleteBlocked = null,
}: SetRowProps) {
  const planned = state === "planned";
  const active = state === "active";
  const editing = active || planned;
  const swipe = useSwipeToDelete(state === "logged" && !deleteBlocked ? onDelete : undefined);
  const warmup = set.isWarmup;
  const uploading = typeof uploadPercent === "number";
  const blocker = completionBlocker(set);
  const confirmable = canComplete(set);
  const showCameraInRpeCell = active && blocker === "video-required";
  const selectable = state === "logged" && Boolean(onSelect);

  const size = warmup ? "warmup" : editing ? "active" : "logged";
  const setLabel = index === "W" ? "Warm-up set" : `Set ${index}`;

  return (
    <div className="flex flex-col">
      <div
        role="group"
        aria-label={setLabel}
        tabIndex={selectable ? 0 : undefined}
        onClick={selectable ? swipe.guardClick(onSelect) : undefined}
        onKeyDown={selectable ? (event) => activateOnKey(event, onSelect) : undefined}
        {...swipe.handlers}
        style={
          {
            gridTemplateColumns: GRID,
            "--set-row-last": editing ? "56px" : "34px",
            ...swipe.style,
          } as unknown as React.CSSProperties
        }
        className={cn(
          "grid items-center gap-2",
          editing
            ? cn(
                "h-16 rounded-row border bg-surface-2 pr-2 pl-2.5",
                // The row the pad is typing into, or the next one to log.
                // A planned row waiting behind it stays quiet.
                active || focused ? "border-accent-line" : "border-border",
              )
            : cn(
                "bg-surface px-2.5",
                warmup ? "h-12" : "h-14",
                uploading && !selected ? "rounded-t-control" : "rounded-control",
                selectable && "cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-line",
                selected && "outline outline-1 outline-border",
              ),
        )}
      >
        <span
          className={cn(
            "font-semibold",
            warmup ? "text-caption text-muted-2" : "text-sm",
            active ? "text-foreground" : "text-muted-2",
          )}
        >
          {index}
        </span>

        <LoadCell
          value={set.loadKg}
          size={size}
          align="left"
          editable={editing}
          placeholder={editing ? "KG" : "—"}
          onPress={onPressLoad}
          label={`${setLabel} weight in kilograms`}
        />

        <LoadCell
          value={set.reps}
          size={size}
          align={editing ? "center" : "left"}
          editable={editing}
          placeholder={editing ? "REPS" : "—"}
          onPress={onPressReps}
          label={`${setLabel} reps`}
        />

        {showCameraInRpeCell ? (
          <button
            type="button"
            onClick={onFilm}
            aria-label={`Film ${setLabel} — video required before it can be logged`}
            className="flex h-12 items-center justify-center rounded-chip border border-accent-fill bg-surface text-accent-fill"
          >
            <CameraIcon width={18} height={18} />
          </button>
        ) : (
          <LoadCell
            value={set.rpe}
            size={size}
            align={editing ? "center" : "left"}
            // Warm-ups never ask for RPE, so the cell is inert rather than empty.
            editable={editing && !warmup}
            placeholder={editing && !warmup ? "RPE" : "—"}
            onPress={onPressRpe}
            label={`${setLabel} RPE`}
          />
        )}

        {active ? (
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmable}
            aria-label={`Log ${setLabel}`}
            className={cn(
              "flex h-14 items-center justify-center rounded-chip text-value-lg font-bold",
              confirmable
                ? "bg-accent-fill text-on-accent"
                : "border border-border bg-surface text-border",
            )}
          >
            ✓
          </button>
        ) : planned ? (
          // Not a confirm: a planned row is logged by becoming the active row.
          // Only one square on the screen means "log this", so the thumb
          // never has to check which one it is on.
          <button
            type="button"
            onClick={onDiscard}
            aria-label={`Remove planned ${setLabel}`}
            className="flex h-14 items-center justify-center rounded-chip border border-border bg-surface text-title text-muted"
          >
            ×
          </button>
        ) : (
          <span className="flex items-center justify-end gap-1.5">
            {pendingSync ? <PendingDot /> : null}
            <span aria-label="Logged" className="text-action text-success">
              ✓
            </span>
          </span>
        )}
      </div>

      {uploading ? <UploadBar percent={uploadPercent} flush /> : null}

      {uploading || pendingSync || note ? (
        <div className="flex justify-between gap-3 px-2.5 pt-[5px] font-mono text-label text-muted-2">
          <span>
            {note ??
              (uploading ? `video uploading ${Math.round(uploadPercent)}%` : null)}
          </span>
          {pendingSync ? <span>queued · no signal</span> : null}
        </div>
      ) : null}

      {selected ? (
        <div className="flex items-center justify-between gap-3 px-1 pt-2">
          {deleteBlocked ? (
            <p className="m-0 text-caption text-muted">{deleteBlocked}</p>
          ) : (
            <Button variant="danger" onClick={onDelete} aria-label={`Delete ${setLabel}`}>
              Delete set
            </Button>
          )}
          <Button variant="ghost" onClick={onSelect}>
            Keep
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function activateOnKey(event: KeyboardEvent, action?: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action?.();
}

/**
 * Swipe left to delete, per the Set Row spec.
 *
 * Pointer events rather than touch events, so it works the same with a thumb,
 * a mouse and a stylus. `touch-action: pan-y` hands vertical movement back to
 * the browser, so scrolling the session with a thumb that lands on a row still
 * scrolls. A drag that turns out to be mostly vertical never becomes a swipe.
 *
 * The gesture is never the only way: tapping the row opens the same Delete,
 * which is what a screen reader, a keyboard, or someone who never guesses that
 * rows swipe will use.
 */
function useSwipeToDelete(onDelete?: () => void) {
  const [dx, setDx] = useState(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const justSwiped = useRef(false);

  const reset = () => {
    origin.current = null;
    dragging.current = false;
    setDx(0);
  };

  if (!onDelete) {
    return { handlers: {}, style: {}, guardClick: (fn?: () => void) => fn };
  }

  return {
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        origin.current = { x: event.clientX, y: event.clientY };
        dragging.current = false;
        justSwiped.current = false;
      },
      onPointerMove: (event: PointerEvent) => {
        if (!origin.current) return;
        const moveX = event.clientX - origin.current.x;
        const moveY = event.clientY - origin.current.y;
        if (!dragging.current) {
          if (Math.abs(moveX) < DRAG_SLOP_PX || Math.abs(moveX) < Math.abs(moveY)) return;
          dragging.current = true;
        }
        setDx(Math.min(0, moveX));
      },
      onPointerUp: () => {
        if (dragging.current) {
          justSwiped.current = true;
          if (dx <= -SWIPE_DELETE_PX) onDelete();
        }
        reset();
      },
      onPointerCancel: reset,
    },
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      touchAction: "pan-y",
      transition: dx ? "none" : "transform 150ms ease-out",
    },
    // A drag ends in a click event too. Without this, every swipe that fell
    // short would also open the row's actions.
    guardClick: (fn?: () => void) => () => {
      if (justSwiped.current) {
        justSwiped.current = false;
        return;
      }
      fn?.();
    },
  };
}

/** Column headers above a block of set rows. Mono, 9px, never a real table. */
export function SetRowHeader() {
  return (
    <div
      style={{ gridTemplateColumns: GRID, "--set-row-last": "34px" } as React.CSSProperties}
      className="grid items-center gap-2 px-2.5 font-mono text-label-xs text-muted-2"
    >
      <span>#</span>
      <span>KG</span>
      <span>REPS</span>
      <span>RPE</span>
      <span />
    </div>
  );
}

/** The target line above a block, e.g. "Target 3 × 5 @ 75% · 142.5 kg". */
export function ExerciseTarget({
  scheme,
  resolvedKg,
}: {
  scheme: string;
  resolvedKg?: number | null;
}) {
  return (
    <div className="text-sm text-muted">
      {scheme}
      {typeof resolvedKg === "number" ? (
        <>
          {" · "}
          {/* Resolved here so nobody does arithmetic between sets. */}
          <span className="font-semibold text-foreground">{formatNumber(resolvedKg)} kg</span>
        </>
      ) : null}
    </div>
  );
}
