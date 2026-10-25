"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { afterExit } from "@/components/ui/motion";

/**
 * A modal over the coach's screen -- and, small and on the spring
 * (`size="sm"`, `feel="athlete"`), the one question the Log screen asks
 * (F18) -- the browser's own `<dialog>`, opened with `showModal()`.
 *
 * Native rather than hand-built because the modal behaviour is the hard part
 * and the platform already does it: the rest of the page goes inert, focus
 * stays inside, Escape asks to close, and it sits in the top layer above the
 * shell. What is added here is only what the native element leaves out --
 * a click on the backdrop closing it, and focus going back to whatever opened
 * it once it unmounts, since React removing a dialog is not the dialog
 * closing itself.
 *
 * Mounted means open. The caller decides when by rendering it (the Athlete
 * View's are driven by the URL, see use-athlete-panel.ts), and `onClose` is a
 * request: it fires at most once per opening, because a single Escape can
 * arrive as both a key event and the dialog's `cancel`, and a close that walks
 * history back twice takes the coach off the page.
 *
 * Opening and closing are animated (docs/coach-motion.md): it settles in from
 * slightly small and below over a fading backdrop, and leaves the same way.
 * Both are CSS transitions on the native element -- `@starting-style` for the
 * entry, `display` and `overlay` transitioned discretely so a closed dialog
 * stays painted in the top layer while it fades. What CSS cannot do is outlive
 * React removing it, so a caller that wants the exit passes `leaving` (from
 * `usePresence`) and unmounts on `onExited`. Leaving closes the native dialog
 * at once: the page is live again, focus is back on the opener and the dialog
 * is out of the accessibility tree before the fade has started, so nothing
 * waits on the animation.
 */

export interface DialogProps {
  /** The id of the heading that names it. */
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * A size rather than a width class: `cn` does not merge Tailwind classes
   * (lib/cn.ts), so an overriding width would lose to the default by CSS
   * order rather than by intent.
   */
  size?: "sm" | "md" | "lg";
  /**
   * Whose motion it moves with. The coach's (the default) settles in on
   * `ease-out` over `panel`; the athlete's arrives on the spring, as
   * everything on the phone does (docs/athlete-motion.md). Both leave on
   * `ease-in` over `base`: something leaving gets out of the way.
   */
  feel?: "coach" | "athlete";
  /** Closed and fading out; see `usePresence`. Omitted, it is open while mounted. */
  leaving?: boolean;
  /** The fade-out has played and it can be unmounted. */
  onExited?: () => void;
}

/** Focus back to whoever had it when the dialog opened, once. */
function handBack(opener: { current: HTMLElement | null }) {
  const to = opener.current;
  opener.current = null;
  if (to && to.isConnected) to.focus();
}

const WIDTH = {
  /** A question on a phone: one line and two buttons, a thumb's width from each edge. */
  sm: "w-[min(360px,calc(100vw-2rem))]",
  md: "w-[min(640px,calc(100vw-4rem))]",
  lg: "w-[min(880px,calc(100vw-4rem))]",
} as const;

export function Dialog({ labelledBy, onClose, children, size = "lg", feel = "coach", leaving = false, onExited }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const requested = useRef(false);
  const onCloseRef = useRef(onClose);
  const onExitedRef = useRef(onExited);
  /** Whoever had the focus when it opened, handed it back exactly once. */
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    onCloseRef.current = onClose;
    onExitedRef.current = onExited;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (leaving) {
      // Closed now, faded after: see the comment at the top.
      if (typeof element.close === "function") {
        if (element.open) element.close();
      } else {
        element.removeAttribute("open");
      }
      handBack(opener);
      return afterExit(element, () => onExitedRef.current?.());
    }
    // Opening, or opening again before a fade-out finished.
    requested.current = false;
    opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // jsdom has no showModal; the attribute is the same dialog, just not modal.
    if (typeof element.showModal === "function") {
      if (!element.open) element.showModal();
    } else {
      element.setAttribute("open", "");
    }
  }, [leaving]);

  useEffect(() => {
    const element = ref.current;
    return () => {
      if (element && typeof element.close === "function" && element.open) element.close();
      handBack(opener);
    };
  }, []);

  const requestClose = () => {
    if (requested.current) return;
    requested.current = true;
    onCloseRef.current();
  };

  return (
    // The keyboard path is the native one: Escape fires `cancel`, handled
    // below. The click handler is only the backdrop, which has no key.
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      onCancel={(event) => {
        // Kept open until the caller unmounts it, so the URL and the screen
        // change together.
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestClose();
        }
      }}
      onClick={(event) => {
        // A click whose target is the dialog element itself landed on the
        // backdrop: content always sits in an inner element.
        if (event.target === event.currentTarget) requestClose();
      }}
      className={cn(
        // Preflight zeroes the margin the browser centres a modal with.
        "m-auto max-h-[calc(100dvh-4rem)] overflow-hidden rounded-card border border-border bg-background p-0 text-foreground",
        "backdrop:bg-black/70",
        // Rest (closed) state, open state, and where opening starts from.
        // Scale and lift only when motion is welcome; the fade always, and
        // the reduced-motion floor in globals.css makes even that instant.
        "opacity-0 motion-safe:translate-y-1 motion-safe:scale-[0.98]",
        "open:translate-y-0 open:scale-100 open:opacity-100",
        "starting:open:opacity-0 motion-safe:starting:open:translate-y-1 motion-safe:starting:open:scale-[0.98]",
        "backdrop:opacity-0 open:backdrop:opacity-100 starting:open:backdrop:opacity-0",
        "transition-[opacity,scale,translate,overlay,display] transition-discrete",
        "backdrop:transition-[opacity,overlay,display] backdrop:transition-discrete",
        leaving
          ? "duration-base ease-in backdrop:duration-base backdrop:ease-in"
          : feel === "athlete"
            ? // The spring and its own duration, always together; the backdrop
              // only fades, so it takes the plain fade-in.
              "duration-spring ease-spring backdrop:duration-base backdrop:ease-out"
            : "duration-panel ease-out backdrop:duration-panel backdrop:ease-out",
        WIDTH[size],
      )}
    >
      <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain p-6">{children}</div>
    </dialog>
  );
}
