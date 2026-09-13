import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Draws the accent border without relying on real focus, for typeahead results. */
  active?: boolean;
  /** Flags a field the error message below refers to. */
  invalid?: boolean;
  /** `lg` is the 56px auth field; `md` the 48px field used everywhere else. */
  size?: "md" | "lg";
}

const SIZES = {
  md: "h-12 px-3 text-body",
  lg: "h-14 px-3.5 text-title",
} as const;

export function TextField({
  active = false,
  invalid = false,
  size = "md",
  className,
  ...props
}: TextFieldProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-control border bg-surface-2 text-foreground",
        "placeholder:text-muted-2",
        "focus:outline-none",
        SIZES[size],
        invalid ? "border-danger-line" : active ? "border-accent-line" : "border-border",
        !invalid && "focus:border-accent-line",
        className,
      )}
      {...props}
    />
  );
}

/** The 10px mono label above a field. */
export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="font-mono text-label text-muted-2 uppercase">
      {children}
    </label>
  );
}
