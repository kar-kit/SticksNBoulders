"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CameraIcon, TrashIcon } from "@/components/ui/icons";
import { afterExit, useChanged } from "@/components/ui/motion";
import { haptic } from "@/lib/ui/haptics";
import { PendingDot, UploadBar } from "@/components/ui/sync-mark";
import { LoadCell } from "./load-cell";
import { SetNoteLine } from "./set-note-field";
import { canComplete, completionBlocker, type LoggableSet } from "@/lib/logging/set";
import { formatNumber } from "@/lib/logging/prefill";
import { loadIn, loadLabel, loadNumber, unitName, type UnitPreference } from "@/lib/units";
import type { PrKind } from "@/lib/strength/pr";

/**
 * The set row. An athlete touches this 20 to 40 times a session, one-handed.
 * Everything else in the product can be mediocre and it survives; this cannot.
 *
 * The fifth column is the confirm target, never the camera. Video attaches from
 * one camera button per exercise -- decided 13 Sep 2026, see the Set Row
 * blueprint. A set the coach wants filmed (`set.videoRequired`) wears a small
 * camera badge: before it is logged, so the athlete knows to set the phone
 * up, and after, until a clip is attached. The badge never blocks the
 * confirm (Order 30: a nudge, never a gate). The blueprint's original gate --
 * the camera taking the RPE cell until a clip exists or Skip is tapped --
 * only applies to a row that can film before it is logged (`onFilm`), which
 * the logger does not offer: a clip needs a logged set to land on.
 *
 * Confirm is 56px, larger than its 48px neighbours, because it is the one
 * target that must be hit first time without looking.
 */

const GRID = "26px 1fr 58px 58px var(--set-row-last)";

/**
 * How far a row has to travel left before letting go deletes it.
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
  /**
   * Films the set before it is logged. Supplying it turns the coach's video
   * ask into the blueprint's gate (camera in the RPE cell, confirm blocked
   * until a clip or a skip). Without it the ask is only a badge.
   */
  onFilm?: () => void;
  /**
   * The row has just been added to the list (planned rows laid out, Add
   * set): it slides in on `animate-row-in`. Rows present when the screen
   * opened do not.
   */
  arrived?: boolean;
  /** Explains a non-athlete-entered load: "suggested from RPE 7 @ 142.5". */
  note?: string | null;
  /**
   * The load is the app's suggestion and still untouched: marks it
   * "Suggested" until the athlete edits it. Offline-safe, because it is
   * derived from row state and never from a request.
   */
  suggested?: boolean;
  /**
   * The pad is editing this row. Only one row on the screen ever is. On a
   * logged row that is the Log's edit sheet correcting it (F9): the row
   * keeps showing what was logged, outlined, until the sheet saves.
   */
  focused?: boolean;
  /**
   * Rows not logged yet (active and planned): drop it before it is done.
   * Swiping it left does it, the same gesture as a logged set; a visually
   * hidden Remove button is the screen-reader and keyboard path. Dropped at
   * once, with no toast: nothing was logged, so nothing is lost.
   */
  onDiscard?: () => void;
  /**
   * Logged rows only. Tapping the row opens what the screen offers for it --
   * on the Log, the edit sheet (which carries Delete); `selected` is the
   * older inline Delete / Keep strip. Swiping it left deletes it straight
   * away. Deletes end in the screen's undo toast, so none asks "are you
   * sure?" first.
   */
  onSelect?: () => void;
  selected?: boolean;
  onDelete?: () => void;
  /** Why this logged set cannot be deleted, shown in place of the button. */
  deleteBlocked?: string | null;
  /**
   * Flips the set between warm-up and working. Makes the set-number / "W"
   * cell a button, on logged rows as well as ones not logged yet.
   */
  onToggleWarmup?: () => void;
  /**
   * The athlete's unit. `set.loadKg` is always kilos; the cell shows it in
   * this unit. Kilos when absent.
   */
  unit?: UnitPreference;
  /**
   * What the set lined up with this row was last time this exercise was
   * trained (Strong's Previous column). Shown on a line under the row,
   * because at 390pt the grid has no room for a sixth column without
   * squeezing the load. Absent when there is no last time or it could not
   * be read: nothing is shown, never an error.
   */
  previous?: { loadKg: number; reps: number } | null;
  /**
   * Rows not logged yet: copies `previous` into the row. Makes the Previous
   * line a button.
   */
  onCopyPrevious?: () => void;
  /** Logged rows: the records this set broke, if any. Shows a PR badge. */
  pr?: readonly PrKind[] | null;
  /**
   * The record was broken by a tap on this page, just now: the badge pops in
   * (`animate-spring-pop`). A badge read back after a reload just sits there.
   */
  prFresh?: boolean;
  /**
   * Logged rows: the athlete's own note on the set (F11). A quiet line under
   * the row -- one truncated line by default, the whole note with
   * `athleteNoteFull` (History, where the note is part of the record). Not
   * `note`, which is the app explaining a suggested load on a row not yet
   * logged.
   */
  athleteNote?: string | null;
  athleteNoteFull?: boolean;
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
  suggested = false,
  focused = false,
  onDiscard,
  onSelect,
  selected = false,
  onDelete,
  deleteBlocked = null,
  onToggleWarmup,
  unit = "kg",
  arrived = false,
  previous = null,
  onCopyPrevious,
  pr = null,
  prFresh = false,
  athleteNote = null,
  athleteNoteFull = false,
}: SetRowProps) {
  const planned = state === "planned";
  const active = state === "active";
  const editing = active || planned;
  // One gesture for both kinds of row. A logged set goes to the screen's undo
  // toast; a row not logged yet is simply dropped, as the old × did.
  const remove = editing ? onDiscard : !deleteBlocked ? onDelete : undefined;
  const outer = useRef<HTMLDivElement>(null);
  const swipe = useSwipeToDelete(outer, remove);
  const warmup = set.isWarmup;
  // Replays the label's pop on every flip, and never on first render.
  const flipped = useChanged(warmup);
  const uploading = typeof uploadPercent === "number";
  // The coach's ask gates the confirm only where the row itself can film.
  const gated = !editing || Boolean(onFilm);
  const checked = gated ? set : { ...set, videoRequired: false };
  const blocker = completionBlocker(checked);
  const confirmable = canComplete(checked);
  const showCameraInRpeCell = active && blocker === "video-required";
  const selectable = state === "logged" && Boolean(onSelect);

  const size = warmup ? "warmup" : editing ? "active" : "logged";
  const setLabel = index === "W" ? "Warm-up set" : `Set ${index}`;
  const videoBadge = set.videoRequired && !showCameraInRpeCell ? videoBadgeOf(set, editing, setLabel) : null;
  const records = state === "logged" && pr && pr.length > 0 ? pr : null;
  const previousText = previous ? `${loadNumber(previous.loadKg, unit)} × ${previous.reps}` : null;
  const copyable = Boolean(previousText && editing && onCopyPrevious);
  const spokenPrevious = previous
    ? `${loadNumber(previous.loadKg, unit)} ${unitName(unit)} for ${previous.reps} reps`
    : "";

  const label = (
    <span
      key={warmup ? "warmup" : "working"}
      className={cn(
        "font-semibold",
        warmup ? "text-caption text-muted-2" : "text-sm",
        active ? "text-foreground" : "text-muted-2",
        flipped && "motion-safe:animate-spring-pop",
      )}
    >
      {index}
    </span>
  );

  return (
    <div
      ref={outer}
      inert={swipe.leaving || undefined}
      data-arrived={arrived || undefined}
      className={cn(
        "flex flex-col",
        arrived && !swipe.leaving && "motion-safe:animate-row-in",
        swipe.leaving && "pointer-events-none motion-safe:animate-fade-out",
      )}
    >
      {/*
        The swipe's reveal: a red Delete behind the row, uncovered as the row
        slides left, iOS-style, so the gesture says what it will do before it
        does it. It turns solid once letting go would delete. Decorative to a
        screen reader -- the row's Delete (logged) or Remove (not logged yet)
        button is the accessible path.
      */}
      <div className="relative">
        {swipe.offset < 0 || swipe.leaving ? (
          <div
            aria-hidden="true"
            data-swipe-reveal={swipe.armed || swipe.leaving ? "armed" : "showing"}
            className={cn(
              "absolute inset-0 flex items-center justify-end gap-1.5 rounded-control bg-danger-fill pr-4",
              "text-ui font-semibold text-on-danger-fill transition-opacity duration-press ease-out",
              swipe.armed || swipe.leaving ? "opacity-100" : "opacity-70",
            )}
          >
            <TrashIcon width={18} height={18} />
            Delete
          </div>
        ) : null}
        <div
          role="group"
          aria-label={setLabel}
          tabIndex={selectable ? 0 : undefined}
          onClick={selectable ? onSelect : undefined}
          onClickCapture={swipe.swallowClick}
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
            "relative grid items-center gap-2",
            swipe.className,
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
                  focused && "outline outline-2 outline-accent-line",
                ),
          )}
        >
          {onToggleWarmup ? (
            // The set number is the warm-up switch, on every row, logged or
            // not. It reaches into the row's left padding and runs its full
            // height, so a thumb gets ~36 x 48 rather than the 26px column.
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                haptic("light");
                onToggleWarmup();
              }}
              aria-label={warmup ? `${setLabel}: make it a working set` : `${setLabel}: mark as warm-up`}
              className="-ml-2.5 flex h-full items-center self-stretch pl-2.5 text-left focus-visible:outline-2 focus-visible:outline-accent-line"
            >
              {label}
            </button>
          ) : (
            label
          )}

          <LoadCell
            value={set.loadKg === null ? null : loadIn(set.loadKg, unit)}
            size={size}
            align="left"
            editable={editing}
            placeholder={editing ? unit.toUpperCase() : "—"}
            onPress={onPressLoad}
            label={`${setLabel} weight in ${unitName(unit)}`}
            marker={editing && suggested ? "Suggested" : undefined}
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
            // Not a confirm, and no longer a ×: a planned row is logged by
            // becoming the active row, and removed by swiping it away. The
            // column stays so the cells line up with the active row's.
            <span />
          ) : (
            <span className="flex items-center justify-end gap-1.5">
              {pendingSync ? <PendingDot /> : null}
              <span aria-label="Logged" className="text-action text-success">
                ✓
              </span>
            </span>
          )}

          {videoBadge ? (
            // Pinned to the row's top-right corner, over the border, so it
            // takes no column from the cells and moves with a swipe.
            <span
              role="img"
              aria-label={videoBadge.label}
              data-video-badge={videoBadge.kind}
              className={cn(
                "pointer-events-none absolute -top-2 right-2 flex h-4 items-center rounded-full border px-1",
                videoBadge.kind === "filmed"
                  ? "border-border bg-surface text-muted-2"
                  : "border-accent-line bg-surface text-accent-line",
              )}
            >
              <CameraIcon width={11} height={11} />
            </span>
          ) : null}

          {records ? (
            // Beside the video badge's corner, never under it, so a filmed PR
            // shows both. Accent fill: the token cleared for small text.
            <span
              role="img"
              aria-label={`${setLabel}: ${prLabel(records)}`}
              data-pr={records.join(" ")}
              className={cn(
                "pointer-events-none absolute -top-2 flex h-4 items-center rounded-full bg-accent-fill px-1.5 font-mono text-label font-semibold text-on-accent",
                videoBadge ? "right-9" : "right-2",
                prFresh && "motion-safe:animate-spring-pop",
              )}
            >
              {prText(records)}
            </span>
          ) : null}

          {editing && onDiscard ? (
            // The non-gesture path for a row not logged yet. Out of sight and
            // out of a thumb's way, the way the × it replaces was not; a
            // screen reader finds it in the row, and a keyboard Tab shows it
            // over the row's right end.
            <button
              type="button"
              onClick={onDiscard}
              aria-label={`Remove planned ${setLabel}`}
              className={cn(
                // sr-only keeps it absolute; focus undoes only the clipping.
                "sr-only inset-y-1.5 right-1.5",
                "focus-visible:m-0 focus-visible:h-auto focus-visible:w-auto focus-visible:overflow-visible focus-visible:[clip-path:none]",
                "focus-visible:flex focus-visible:items-center focus-visible:gap-1.5 focus-visible:rounded-chip",
                "focus-visible:bg-danger-fill focus-visible:px-3 focus-visible:text-ui focus-visible:font-semibold",
                "focus-visible:text-on-danger-fill focus-visible:outline-2 focus-visible:outline-accent-line",
              )}
            >
              <TrashIcon width={16} height={16} />
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {uploading ? <UploadBar percent={uploadPercent} flush /> : null}

      {uploading || pendingSync || note || previousText ? (
        <div className="flex justify-between gap-3 px-2.5 pt-[5px] font-mono text-label text-muted-2">
          <span className="flex min-w-0 items-center gap-3">
            {previousText ? (
              copyable ? (
                // Taller than it looks, so a thumb finds it: the padding
                // reaches into the gap above and below without moving the
                // line, and stays clear of the cells.
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    onCopyPrevious?.();
                  }}
                  aria-label={`${setLabel}: use last time, ${spokenPrevious}`}
                  data-previous=""
                  className="-my-2 -ml-1 flex-none rounded-chip px-1 py-2 text-muted tap focus-visible:outline-2 focus-visible:outline-accent-line"
                >
                  PREV {previousText}
                </button>
              ) : (
                <span data-previous="" aria-label={`${setLabel} last time: ${spokenPrevious}`} className="flex-none">
                  PREV {previousText}
                </span>
              )
            ) : null}
            {note ? <span className="min-w-0">{note}</span> : null}
            {!note && uploading ? <span>video uploading {Math.round(uploadPercent)}%</span> : null}
          </span>
          {pendingSync ? <span>queued · no signal</span> : null}
        </div>
      ) : null}

      {state === "logged" && athleteNote?.trim() ? (
        <SetNoteLine note={athleteNote.trim()} full={athleteNoteFull} />
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

/**
 * What the PR badge says. "PR" for a strength record, the e1RM or the weight;
 * "Rep PR" when the set's only record is reps at its load, the smaller claim,
 * so a back-off triple's badge does not read like a new top single.
 */
function prText(kinds: readonly PrKind[]): string {
  return kinds.every((kind) => kind === "reps") ? "Rep PR" : "PR";
}

const PR_WORDS: Record<PrKind, string> = {
  e1rm: "estimated one-rep max",
  weight: "heaviest weight",
  reps: "most reps at this weight",
};

/** What the PR badge says to a screen reader. */
function prLabel(kinds: readonly PrKind[]): string {
  return `personal record, ${kinds.map((kind) => PR_WORDS[kind]).join(" and ")}`;
}

/** What the camera badge on a flagged row says, and how loudly. */
function videoBadgeOf(
  set: LoggableSet,
  editing: boolean,
  setLabel: string,
): { kind: "requested" | "missing" | "filmed"; label: string } {
  if (editing) return { kind: "requested", label: `${setLabel}: your coach asked for a video` };
  if (set.hasVideo) return { kind: "filmed", label: `${setLabel}: video attached` };
  return { kind: "missing", label: `${setLabel}: your coach asked for a video, not filmed yet` };
}

function activateOnKey(event: KeyboardEvent, action?: () => void) {
  // Only the row's own keys: Enter on the warm-up button inside it is that
  // button's, and must not also open the row's actions.
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action?.();
}

/**
 * Swipe left to delete, per the Set Row spec, on every row: logged sets and
 * rows not logged yet alike.
 *
 * iOS's list-row swipe. The row follows the finger, uncovering a red Delete
 * behind it. Past `SWIPE_DELETE_PX` it arms -- the reveal goes solid and the
 * phone gives one `medium` buzz where it can -- and letting go there sends
 * the row off to the left while it fades (`afterExit` waits for that, then
 * deletes). Let go short of it and the row springs back on `ease-spring`.
 * Nothing animates height: once the row is gone, the list closes up in one
 * step (docs/athlete-motion.md, "no layout animation").
 *
 * Pointer events rather than touch events, so it works the same with a thumb,
 * a mouse and a stylus. `touch-action: pan-y` hands vertical movement back to
 * the browser, so scrolling the session with a thumb that lands on a row still
 * scrolls. A drag that turns out to be mostly vertical never becomes a swipe.
 * Once it is a swipe the row captures the pointer, so a thumb that drifts off
 * the row's 48px mid-drag keeps driving it.
 *
 * The gesture is never the only way: tapping a logged row opens the same
 * Delete, and a row not logged yet carries a Remove button for a screen
 * reader or a keyboard.
 */
function useSwipeToDelete(ref: RefObject<HTMLElement | null>, onDelete?: () => void) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const justSwiped = useRef(false);
  const wasArmed = useRef(false);
  const deleteRef = useRef(onDelete);

  useEffect(() => {
    deleteRef.current = onDelete;
  });

  // The row has started leaving: wait for its exit to play, then delete. The
  // reset lands in the same render as the delete, so a row the screen keeps
  // (a delete it refused) comes back rather than staying invisible.
  useEffect(() => {
    if (!leaving) return;
    return afterExit(ref.current, () => {
      deleteRef.current?.();
      setLeaving(false);
      setDx(0);
    });
  }, [leaving, ref]);

  const reset = () => {
    origin.current = null;
    dragging.current = false;
    wasArmed.current = false;
    setDx(0);
  };

  if (!onDelete) {
    return { handlers: {}, style: {}, className: "", offset: 0, armed: false, leaving: false, swallowClick: undefined };
  }

  const armed = dx <= -SWIPE_DELETE_PX;

  return {
    /** How far the row has been dragged, negative to the left. */
    offset: dx,
    /** Letting go here deletes. */
    armed,
    /** Let go armed: the row is on its way out. */
    leaving,
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        if (leaving) return;
        origin.current = { x: event.clientX, y: event.clientY };
        dragging.current = false;
        justSwiped.current = false;
        wasArmed.current = false;
      },
      onPointerMove: (event: PointerEvent) => {
        if (!origin.current) return;
        const moveX = event.clientX - origin.current.x;
        const moveY = event.clientY - origin.current.y;
        if (!dragging.current) {
          if (Math.abs(moveX) < DRAG_SLOP_PX || Math.abs(moveX) < Math.abs(moveY)) return;
          dragging.current = true;
          const el = event.currentTarget as Element;
          if (typeof el.setPointerCapture === "function") {
            try {
              el.setPointerCapture(event.pointerId);
            } catch {
              // A pointer that already ended. The drag still works uncaptured.
            }
          }
        }
        const next = Math.min(0, moveX);
        const nowArmed = next <= -SWIPE_DELETE_PX;
        // Once per crossing, not once per frame past the line.
        if (nowArmed && !wasArmed.current) haptic("medium");
        wasArmed.current = nowArmed;
        setDx(next);
      },
      onPointerUp: () => {
        if (dragging.current) {
          justSwiped.current = true;
          if (armed) {
            origin.current = null;
            dragging.current = false;
            setLeaving(true);
            return;
          }
        }
        reset();
      },
      onPointerCancel: reset,
    },
    style: {
      transform: leaving ? "translateX(-100%)" : dx ? `translateX(${dx}px)` : undefined,
      touchAction: "pan-y",
    },
    // Under the finger: no transition, it tracks 1:1. Let go short: back on
    // the spring. Let go armed: out on ease-in, the way things leave.
    className: leaving
      ? "motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-in"
      : dx
        ? ""
        : "motion-safe:transition-transform motion-safe:duration-spring motion-safe:ease-spring",
    // A drag ends in a click too, on whichever cell it started over. Without
    // this, a swipe that fell short would open the row's actions or the pad.
    swallowClick: (event: MouseEvent) => {
      if (!justSwiped.current) return;
      justSwiped.current = false;
      event.stopPropagation();
      event.preventDefault();
    },
  };
}

/** Column headers above a block of set rows. Mono, 9px, never a real table. */
export function SetRowHeader({ unit = "kg" }: { unit?: UnitPreference } = {}) {
  return (
    <div
      style={{ gridTemplateColumns: GRID, "--set-row-last": "34px" } as React.CSSProperties}
      className="grid items-center gap-2 px-2.5 font-mono text-label-xs text-muted-2"
    >
      <span>#</span>
      <span>{unit.toUpperCase()}</span>
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
  unit = "kg",
}: {
  scheme: string;
  resolvedKg?: number | null;
  unit?: UnitPreference;
}) {
  return (
    <div className="text-sm text-muted">
      {scheme}
      {typeof resolvedKg === "number" ? (
        <>
          {" · "}
          {/* Resolved here so nobody does arithmetic between sets. */}
          <span className="font-semibold text-foreground">
            {unit === "kg" ? `${formatNumber(resolvedKg)} kg` : loadLabel(resolvedKg, unit)}
          </span>
        </>
      ) : null}
    </div>
  );
}
