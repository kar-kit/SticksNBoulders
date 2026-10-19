"use client";

import { useEffect, useRef, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Small pieces the Program Editor and its outline share. Kept apart so the
 * outline does not import the editor that renders it.
 */

/**
 * A grid cell's input: uncontrolled while the coach types, and given the
 * saved value whenever it is not the one being typed in.
 *
 * The grid used to key each cell on its text so a save re-rendered it with
 * the new value. That remounted the input, and a remounted input has lost
 * the focus: shorthand (`5x3` in sets also fills reps) changes the very cell
 * Tab has just moved into, so the keyboard fell out of the grid mid-line.
 * Here the element stays and only its value moves -- unless the coach has
 * typed into it since it took the focus, which is never overwritten. Escape
 * puts back `defaultValue`, which is therefore always the saved value.
 */
export function CellInput({
  value,
  revision,
  onFocus,
  onInput,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & {
  value: string;
  /** Anything else the saved cell depends on: a change puts the text back even when `value` did not move. */
  revision?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  /** Typed into since it last took the focus: the coach's text wins. */
  const typed = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.defaultValue = value;
    if (el.ownerDocument.activeElement !== el || !typed.current) el.value = value;
  }, [value, revision]);
  return (
    <input
      ref={ref}
      defaultValue={value}
      onFocus={(e) => {
        typed.current = false;
        onFocus?.(e);
      }}
      onInput={(e) => {
        typed.current = true;
        onInput?.(e);
      }}
      {...props}
    />
  );
}

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
        "min-w-0 rounded-control border border-transparent bg-transparent px-1 text-foreground transition-control",
        "placeholder:text-muted-2 hover:border-border focus:border-accent-line focus:outline-none",
        className,
      )}
    />
  );
}

/**
 * Removal asks once, inline, rather than in a dialog that steals the keyboard.
 * Opened from a ⋯ menu's "Remove …" item; the confirm takes the focus so the
 * keyboard lands on it. It rises in beside the thing it would remove, so the
 * question is seen to belong to that thing.
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
    <span
      role="group"
      aria-label={`${label}?`}
      className={cn("flex flex-wrap items-center gap-2 motion-safe:animate-rise-in", className)}
    >
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
