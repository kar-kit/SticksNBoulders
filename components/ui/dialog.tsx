"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A modal over the coach's screen: the browser's own `<dialog>`, opened with
 * `showModal()`.
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
 * No animation, on purpose: a separate ticket owns motion.
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
  size?: "md" | "lg";
}

const WIDTH = {
  md: "w-[min(640px,calc(100vw-4rem))]",
  lg: "w-[min(880px,calc(100vw-4rem))]",
} as const;

export function Dialog({ labelledBy, onClose, children, size = "lg" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const requested = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // jsdom has no showModal; the attribute is the same dialog, just not modal.
    if (typeof element.showModal === "function") {
      if (!element.open) element.showModal();
    } else {
      element.setAttribute("open", "");
    }
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
      if (opener && opener.isConnected) opener.focus();
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
        WIDTH[size],
      )}
    >
      <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto p-6">{children}</div>
    </dialog>
  );
}
