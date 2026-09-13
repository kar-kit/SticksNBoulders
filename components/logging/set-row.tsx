"use client";

import { cn } from "@/lib/cn";
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

export interface SetRowProps {
  /** Set number, or "W" for a warm-up. */
  index: number | "W";
  set: LoggableSet;
  /** Logged rows are read-only; the active row is the one being entered. */
  state: "logged" | "active";
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
}: SetRowProps) {
  const active = state === "active";
  const warmup = set.isWarmup;
  const uploading = typeof uploadPercent === "number";
  const blocker = completionBlocker(set);
  const confirmable = canComplete(set);
  const showCameraInRpeCell = active && blocker === "video-required";

  const size = warmup ? "warmup" : active ? "active" : "logged";
  const setLabel = index === "W" ? "Warm-up set" : `Set ${index}`;

  return (
    <div className="flex flex-col">
      <div
        role="group"
        aria-label={setLabel}
        style={
          {
            gridTemplateColumns: GRID,
            "--set-row-last": active ? "56px" : "34px",
          } as React.CSSProperties
        }
        className={cn(
          "grid items-center gap-2",
          active
            ? "h-16 rounded-row border border-accent-line bg-surface-2 pr-2 pl-2.5"
            : cn(
                "bg-surface px-2.5",
                warmup ? "h-12" : "h-14",
                uploading ? "rounded-t-control" : "rounded-control",
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
          editable={active}
          placeholder={active ? "KG" : "—"}
          onPress={onPressLoad}
          label={`${setLabel} weight in kilograms`}
        />

        <LoadCell
          value={set.reps}
          size={size}
          align={active ? "center" : "left"}
          editable={active}
          placeholder={active ? "REPS" : "—"}
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
            align={active ? "center" : "left"}
            // Warm-ups never ask for RPE, so the cell is inert rather than empty.
            editable={active && !warmup}
            placeholder={active && !warmup ? "RPE" : "—"}
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
    </div>
  );
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
