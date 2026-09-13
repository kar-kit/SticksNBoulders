import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Coach-side table. Built from grid rows rather than <table> so column widths
 * stay declarative across header and body, and so a row can carry an indicator
 * dot without a nested layout. Semantics are restored with ARIA roles.
 */
export interface TableProps {
  /** A CSS grid-template-columns value, e.g. "1.4fr 1fr 1fr 1fr". */
  columns: string;
  children: ReactNode;
  className?: string;
}

export function Table({ columns, children, className }: TableProps) {
  return (
    <div
      role="table"
      style={{ "--table-cols": columns } as React.CSSProperties}
      className={cn("overflow-hidden rounded-control border border-border", className)}
    >
      {children}
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <div
      role="row"
      className="grid h-[34px] items-center gap-3 border-b border-border bg-surface px-[14px]"
      style={{ gridTemplateColumns: "var(--table-cols)" }}
    >
      {children}
    </div>
  );
}

export function TableHeader({ children, sorted }: { children: ReactNode; sorted?: "asc" | "desc" }) {
  return (
    <span
      role="columnheader"
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
      className="font-mono text-label-xs text-muted-2 uppercase"
    >
      {children}
      {sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : null}
    </span>
  );
}

export function TableRow({ children, striped = false }: { children: ReactNode; striped?: boolean }) {
  return (
    <div
      role="row"
      className={cn(
        "grid h-[42px] items-center gap-3 border-b border-border px-[14px] text-ui last:border-b-0",
        striped && "bg-surface",
      )}
      style={{ gridTemplateColumns: "var(--table-cols)" }}
    >
      {children}
    </div>
  );
}

export function TableCell({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span role="cell" className={cn(strong && "font-semibold")}>
      {children}
    </span>
  );
}
