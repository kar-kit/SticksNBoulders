"use client";

import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import { afterExit, usePresence } from "@/components/ui/motion";

/**
 * The bottom sheet the Log screen types into: the number pad, or the RPE chips.
 *
 * It used to sit in normal flow at the end of the page, under End session. A
 * prescribed session lists every planned block up front, so on anything but
 * the shortest day the pad opened below the fold, away from the row it was
 * typing into. Now it is pinned to the bottom of the scrolling area -- just
 * above the tab bar, which already carries the home-indicator inset -- and
 * covers whatever is there, the way the iOS keyboard does.
 *
 * Pinned with `sticky`, not `fixed`. The sheet stays in flow as the last
 * thing on the page, so its own height is reserved at the end of the content
 * and the last rows can always scroll up above it, with no measured padding
 * to keep in step. And it is positioned inside <main>, so it can never sit on
 * the tab bar or need to know how tall that is.
 *
 * No backdrop: the rows behind stay live, because tapping another field while
 * the pad is open is how an athlete moves between them. Swapping pad for RPE
 * swaps the content of an open sheet; only opening and closing animate.
 * docs/athlete-motion.md has the tokens.
 */

/** Gap left between the revealed row and the top edge of the sheet. */
export const REVEAL_GAP_PX = 12;

export interface LogSheetProps {
  /** What the sheet holds. Null or false closes it. */
  children: ReactElement | null | false;
  /**
   * The element to keep visible above the sheet: the set row being typed
   * into. Read when the sheet opens and whenever `revealKey` changes.
   */
  anchor: RefObject<Element | null>;
  /** Changes when focus moves to another row or field. */
  revealKey: string | null;
}

export function LogSheet({ children, anchor, revealKey }: LogSheetProps) {
  const { shown, leaving, exited } = usePresence(children);
  const ref = useRef<HTMLDivElement>(null);

  // Unmount once the exit has played: at once under reduced motion, where the
  // animation is gated off and there is nothing to wait for.
  useEffect(() => {
    if (!leaving) return;
    return afterExit(ref.current, exited);
    // `exited` is a fresh closure each render; the exit starts once per leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const open = Boolean(children);
  useEffect(() => {
    if (!open || !ref.current) return;
    revealAboveSheet(anchor.current, ref.current);
  }, [open, revealKey, anchor]);

  if (!shown) return null;
  return (
    <div
      ref={ref}
      data-log-sheet=""
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
      className={
        // -mx-4 undoes the shell's gutters so the sheet runs edge to edge.
        "sticky bottom-0 z-10 -mx-4 flex-none rounded-t-card border-t border-border bg-surface " +
        (leaving ? "motion-safe:animate-sheet-out" : "motion-safe:animate-sheet-in")
      }
    >
      {shown}
    </div>
  );
}

/**
 * How far to scroll so `target` sits wholly in the part of the viewport the
 * sheet leaves uncovered. Positive scrolls down. Zero when it is already
 * there. A target taller than that space is aligned by its bottom edge,
 * because the fields being typed into are at the row's bottom.
 */
export function revealDelta(
  target: { top: number; bottom: number },
  viewport: { top: number; bottom: number },
  sheetHeight: number,
  gap: number = REVEAL_GAP_PX,
): number {
  const visibleBottom = viewport.bottom - sheetHeight - gap;
  if (target.bottom > visibleBottom) return target.bottom - visibleBottom;
  const visibleTop = viewport.top + gap;
  if (target.top < visibleTop) return target.top - visibleTop;
  return 0;
}

/**
 * Scrolls the sheet's scroll container so `target` sits just above the sheet.
 *
 * The sheet's height is its layout height, which the slide-in's translate
 * does not change, so this is right on the first frame of the animation.
 * Smooth unless the athlete asked for reduced motion: smooth scrolling is
 * not an animation the stylesheet's reduced-motion floor can reach.
 */
export function revealAboveSheet(target: Element | null, sheet: HTMLElement): void {
  if (!target || !target.isConnected) return;
  const scroller = sheet.closest("main") ?? document.scrollingElement;
  if (!(scroller instanceof HTMLElement)) return;
  const delta = revealDelta(
    target.getBoundingClientRect(),
    scroller === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight }
      : scroller.getBoundingClientRect(),
    sheet.offsetHeight,
  );
  if (delta === 0) return;
  const reduce =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
  if (typeof scroller.scrollBy === "function") scroller.scrollBy({ top: delta, behavior });
  else scroller.scrollTop += delta;
}
