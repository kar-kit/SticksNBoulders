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
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        VARIANTS[variant],
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
