import { cn } from "@/lib/cn";

/**
 * Offline is normal, not an error. These marks are deliberately quiet: no
 * spinner, no warning colour, nothing that reads as a failure. A queued set
 * looks like a logged set with a small dot.
 */

export function PendingDot({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Queued, will sync"
      className={cn("block size-1.5 rounded-full bg-muted-2", className)}
    />
  );
}

export function LoggedTick({ className }: { className?: string }) {
  return (
    <span aria-label="Logged" className={cn("text-action text-success", className)}>
      ✓
    </span>
  );
}

export interface UploadBarProps {
  /** 0-100. Clamped, because a wrong percentage is worse than no bar. */
  percent: number;
  /** Squares the top corners so the bar can sit flush under a set row. */
  flush?: boolean;
  className?: string;
}

export function UploadBar({ percent, flush = false, className }: UploadBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="progressbar"
      aria-label="Video uploading"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-0.5 overflow-hidden bg-border",
        flush ? "rounded-b-control" : "rounded-hairline",
        className,
      )}
    >
      <span className="block h-0.5 bg-accent-line" style={{ width: `${clamped}%` }} />
    </div>
  );
}
