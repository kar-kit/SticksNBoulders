"use client";

import { cn } from "@/lib/cn";

export interface TabsProps<T extends string> {
  tabs: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Labels the tablist for screen readers, e.g. "Lifts". */
  label: string;
}

/**
 * The selected tab's 2px rule grows in under it as the old one shrinks away
 * (`rule-b`, globals.css), so a switch reads as the selection moving. Tabs
 * appear only on coach screens and the design sheet.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-0.5">
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative h-[34px] overflow-hidden rounded-chip px-[14px] text-sm",
              "transition-control press rule-b aria-selected:rule-on",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
              selected
                ? "bg-surface-2 font-semibold text-foreground"
                : "text-muted hover:bg-surface-2/60 hover:text-foreground focus-visible:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
