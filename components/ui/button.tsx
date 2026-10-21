import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<ButtonVariant, string> = {
  // Fill tokens only. accent-line is 4.22:1 and never sits behind a label.
  primary:
    "bg-accent-fill text-on-accent font-bold " +
    "active:bg-accent-pressed active:text-on-accent-pressed " +
    "disabled:bg-surface-2 disabled:text-muted-2 disabled:font-bold",
  secondary:
    "bg-surface text-foreground border border-border font-medium " +
    "active:bg-surface-2 disabled:text-muted-2",
  ghost: "text-muted font-medium active:text-foreground disabled:text-muted-2",
  danger:
    "border border-danger-line text-foreground font-semibold " +
    "active:bg-danger-fill active:text-on-danger-fill",
};

/*
 * Hover, mirrored on keyboard focus, for the coach's pointer and keyboard.
 * Behind `coach:` (globals.css) because this button is also the athlete's,
 * held mid-set where there is no hover and the press state is the feedback.
 */
const COACH_HOVER: Record<ButtonVariant, string> = {
  primary: "coach:enabled:hover:opacity-90 coach:focus-visible:opacity-90",
  secondary: "coach:enabled:hover:bg-surface-2 coach:focus-visible:bg-surface-2",
  ghost: "coach:enabled:hover:text-foreground coach:focus-visible:text-foreground",
  danger: "coach:enabled:hover:bg-danger-fill/15 coach:focus-visible:bg-danger-fill/15",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-[14px] text-ui rounded-chip",
  md: "h-11 px-[18px] text-body rounded-control",
  lg: "h-12 px-[22px] text-action rounded-control",
  xl: "h-14 px-[22px] text-title rounded-control",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container. Sign-in and empty-state actions do this. */
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap",
        "transition-colors disabled:cursor-not-allowed",
        // On the coach side the shared transition tokens and a press;
        // docs/coach-motion.md. On the athlete's, the thumb press with a
        // spring release; docs/athlete-motion.md.
        "coach:transition-control coach:press athlete:tap",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        VARIANTS[variant],
        COACH_HOVER[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
