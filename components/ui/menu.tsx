"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * The ⋯ menu: one button that opens a short list of actions.
 *
 * Built here rather than pulled in, because it is the only popup the coach
 * side needs and it is small. The WAI-ARIA menu button pattern: the trigger
 * says it has a menu and whether it is open; opening by click, Enter, Space or
 * Down puts the focus on the first item, Up on the last; arrows, Home and End
 * move between items; Escape closes and hands the focus back to the trigger;
 * Tab or a click anywhere else just closes. Choosing an item closes the menu
 * first, so an action that removes the row the menu sat on leaves nothing open.
 */

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** A destructive action. Still needs its own confirm where it removes something. */
  tone?: "danger";
  disabled?: boolean;
}

export interface MenuProps {
  /** The trigger's accessible name, and the menu's: "Week 2 actions". */
  label: string;
  /** Falsy entries are skipped, so a caller can write `cond && {...}`. */
  items: ReadonlyArray<MenuItem | null | false | undefined>;
  disabled?: boolean;
  className?: string;
}

export function Menu({ label, items, disabled, className }: MenuProps) {
  const shown = items.filter((item): item is MenuItem => Boolean(item));
  const [open, setOpen] = useState(false);
  const [focusAt, setFocusAt] = useState<"first" | "last" | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const itemsEls = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open || !focusAt) return;
    const els = itemsEls();
    (focusAt === "first" ? els[0] : els.at(-1))?.focus();
  }, [open, focusAt]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  if (shown.length === 0) return null;

  const show = (at: "first" | "last") => {
    setFocusAt(at);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    setFocusAt(null);
    if (refocus) trigger.current?.focus();
  };

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const els = itemsEls();
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    const go = (to: number) => {
      event.preventDefault();
      els[(to + els.length) % els.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return go(at + 1);
      case "ArrowUp":
        return go(at < 0 ? els.length - 1 : at - 1);
      case "Home":
        return go(0);
      case "End":
        return go(els.length - 1);
      case "Escape":
        event.preventDefault();
        return close(true);
      case "Tab":
        return close(false);
    }
  };

  return (
    <div ref={wrapper} className={cn("relative inline-flex", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : show("first"))}
        onKeyDown={onTriggerKey}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-chip text-muted",
          "hover:bg-surface-2 hover:text-foreground disabled:text-muted-2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
          open && "bg-surface-2 text-foreground",
        )}
      >
        <span aria-hidden="true" className="text-title leading-none">
          ⋯
        </span>
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onListKey}
          className="absolute top-full right-0 z-30 mt-1 flex min-w-52 flex-col rounded-card border border-border bg-surface p-1 shadow-lg"
        >
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={cn(
                "flex h-9 items-center rounded-chip px-3 text-left text-ui whitespace-nowrap",
                "hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:text-muted-2",
                item.tone === "danger" ? "text-danger-line" : "text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
