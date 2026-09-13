"use client";

import { cn } from "@/lib/cn";

export interface TabsProps<T extends string> {
  tabs: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Labels the tablist for screen readers, e.g. "Lifts". */
  label: string;
}

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
              "h-[34px] rounded-chip px-[14px] text-sm",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
              selected
                ? "bg-surface-2 font-semibold text-foreground shadow-[inset_0_-2px_0_var(--accent-fill)]"
                : "text-muted",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
