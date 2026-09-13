"use client";

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
  className,
}: LoadCellProps) {
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
      className={cn(
        "flex h-12 items-center rounded-chip border bg-surface",
        align === "left" ? "px-2.5" : "px-1",
        focused ? "border-accent-line" : "border-border",
        "focus-visible:border-accent-line focus-visible:outline-none",
        content,
        className,
      )}
    >
      {text}
    </button>
  );
}
