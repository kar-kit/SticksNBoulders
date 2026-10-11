"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Small pieces the Program Editor and its outline share. Kept apart so the
 * outline does not import the editor that renders it.
 */

/** A text that saves when left. Escape puts it back. */
export function InlineText({
  label,
  value,
  placeholder,
  disabled,
  className,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onCommit: (value: string) => unknown;
}) {
  return (
    <input
      aria-label={label}
      defaultValue={value}
      key={value}
      placeholder={placeholder}
      disabled={disabled}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next !== value.trim()) void onCommit(next);
      }}
      className={cn(
        "min-w-0 rounded-control border border-transparent bg-transparent px-1 text-foreground",
        "placeholder:text-muted-2 hover:border-border focus:border-accent-line focus:outline-none",
        className,
      )}
    />
  );
}

/**
 * Removal asks once, inline, rather than in a dialog that steals the keyboard.
 * Opened from a ⋯ menu's "Remove …" item; the confirm takes the focus so the
 * keyboard lands on it.
 */
export function ConfirmStrip({
  label,
  disabled,
  onConfirm,
  onCancel,
  className,
}: {
  label: string;
  disabled?: boolean;
  onConfirm: () => unknown;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <span role="group" aria-label={`${label}?`} className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-ui text-muted">Logged sessions keep what was done.</span>
      <Button
        variant="danger"
        size="sm"
        autoFocus
        disabled={disabled}
        onClick={() => {
          onCancel();
          void onConfirm();
        }}
      >
        Confirm {label.toLowerCase()}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Keep
      </Button>
    </span>
  );
}
