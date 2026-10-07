"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/logging/prefill";

/**
 * The load cell. Displays or edits one number that an athlete reads at arm's
 * length, breathing hard, in bad light.
 *
 * Two jobs, hence two modes. In `display` it is a bare tabular figure with no
 * chrome, so a column of logged sets reads as a column of numbers. In `edit` it
 * is a 48px box with its own border, tall enough to hit without looking.
 *
 * It never opens a keyboard. Tapping it raises the number pad, which is why
 * this renders a button rather than an <input>.
 */

export type LoadCellSize = "warmup" | "logged" | "active";
export type LoadCellAlign = "left" | "center";

const SIZES: Record<LoadCellSize, string> = {
  // Warm-ups are quieter: smaller, lighter, muted. They are context, not work.
  warmup: "text-value-sm font-medium text-muted",
  logged: "text-value-lg font-semibold text-foreground",
  active: "text-value-lg font-semibold text-foreground",
};

export interface LoadCellProps {
  value: number | null;
  size?: LoadCellSize;
  align?: LoadCellAlign;
  /** Renders the bordered 48px box and makes the cell tappable. */
  editable?: boolean;
  /** Shown when value is null. "RPE" on the RPE cell, "—" on a warm-up. */
  placeholder?: string;
  /** Accent border, for the cell the number pad is currently editing. */
  focused?: boolean;
  onPress?: () => void;
  label: string;
  /**
   * A word that sits on the cell's top border, for a value the athlete did not
   * type ("Suggested"). Editable cells only. It is the cell's accessible
   * description, so a screen reader hears it without the name changing.
   */
  marker?: string;
  className?: string;
}

export function LoadCell({
  value,
  size = "logged",
  align = "left",
  editable = false,
  placeholder = "—",
  focused = false,
  onPress,
  label,
  marker,
  className,
}: LoadCellProps) {
  const markerId = useId();
  const empty = value === null;
  const text = empty ? placeholder : formatNumber(value);

  const content = cn(
    SIZES[size],
    // An empty cell's placeholder is a label, not a value: drop it to mono and
    // mute it so it never reads as a logged number.
    empty && "font-mono text-meta font-medium tracking-[0.06em] text-muted-2",
    align === "center" ? "justify-center" : "justify-start",
  );

  if (!editable) {
    return (
      <span aria-label={label} className={cn("flex items-center", content, className)}>
        {text}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      aria-describedby={marker ? markerId : undefined}
      className={cn(
        "relative flex h-12 items-center rounded-chip border bg-surface",
        align === "left" ? "px-2.5" : "px-1",
        focused ? "border-accent-line" : "border-border",
        "focus-visible:border-accent-line focus-visible:outline-none",
        content,
        className,
      )}
    >
      {text}
      {marker ? (
        // A filled chip, not an outline: the fill token is the one cleared for
        // small text (5.68:1 with --on-accent). It straddles the border so the
        // number keeps the cell to itself, and ignores taps so the whole cell
        // still opens the pad.
        <span
          id={markerId}
          className="pointer-events-none absolute -top-[7px] left-2 rounded-hairline bg-accent-fill px-1 py-0.5 font-mono text-label font-semibold uppercase text-on-accent"
        >
          {marker}
        </span>
      ) : null}
    </button>
  );
}
