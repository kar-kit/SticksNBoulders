import { cn } from "@/lib/cn";

/**
 * A grey block where something is about to be, with a slow sheen across it.
 *
 * For coach screens that used to be blank while they loaded (the Program
 * Editor, Programs), so the first paint already has the page's shape and the
 * content fades in over it rather than popping onto nothing. The sheen is the
 * coach side's one looping animation and runs only when motion is welcome;
 * with reduced motion it is a still block. Purely decorative: the caller
 * keeps `aria-busy` on the region, and the block is hidden from assistive
 * technology.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block overflow-hidden rounded-chip bg-surface-2",
        "after:absolute after:inset-0 after:bg-linear-to-r after:from-transparent after:via-foreground/5 after:to-transparent",
        "after:-translate-x-full motion-safe:after:animate-shimmer",
        className,
      )}
    />
  );
}
