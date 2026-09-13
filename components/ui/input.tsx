import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Draws the accent border without relying on real focus, for typeahead results. */
  active?: boolean;
}

export function TextField({ active = false, className, ...props }: TextFieldProps) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-control border bg-surface-2 px-3 text-body text-foreground",
        "placeholder:text-muted-2",
        "focus:border-accent-line focus:outline-none",
        active ? "border-accent-line" : "border-border",
        className,
      )}
      {...props}
    />
  );
}
