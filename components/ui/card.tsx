import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps {
  /**
   * Draws the 2px accent rule down the left edge. Reserved for the coach's
   * "needs you" items -- if everything is flagged, nothing is.
   */
  attention?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ attention = false, className, children }: CardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-control border border-border bg-surface p-[14px]",
        attention && "border-l-2 border-l-accent-line",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <span className="text-body font-semibold">{children}</span>;
}

export function CardBody({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted">{children}</span>;
}

/** Mono, muted, for counts and tonnage under a card title. */
export function CardMeta({ children }: { children: ReactNode }) {
  return <span className="font-mono text-meta text-muted-2">{children}</span>;
}
