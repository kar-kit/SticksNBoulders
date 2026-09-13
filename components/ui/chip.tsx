import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ChipTone = "neutral" | "selected" | "outline" | "success" | "accent";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-surface-2 text-foreground font-semibold",
  selected: "bg-accent-fill text-on-accent font-bold",
  outline: "border border-border text-muted",
  // Outline tones use the line tokens as borders and as text on the base
  // background, where success is 6.08:1. Never as a fill behind a label.
  success: "border border-success text-success font-semibold text-sm",
  accent: "border border-accent-line text-foreground font-semibold text-sm",
};

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ChipTone;
  children: ReactNode;
}

/** Renders a button when interactive, a span when it is only a label. */
export function Chip({ tone = "neutral", className, children, onClick, ...props }: ChipProps) {
  const classes = cn(
    "inline-flex h-9 items-center justify-center rounded-chip px-[14px] text-ui",
    TONES[tone],
    className,
  );

  if (!onClick) {
    return (
      <span className={classes} {...(props as Record<string, unknown>)}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        classes,
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
      )}
      {...props}
    >
      {children}
    </button>
  );
}
