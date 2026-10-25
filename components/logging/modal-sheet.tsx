"use client";

import { useEffect, useRef, type ReactElement, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { afterExit, usePresence } from "@/components/ui/motion";
import { revealAboveSheet } from "./log-sheet";

/**
 * A bottom sheet over a dimmed page: the Log's "Edit set N" sheet (F16).
 *
 * The keypad that logs a set has no backdrop on purpose -- the rows behind it
 * stay live, because tapping the next field is how an athlete moves on
 * (log-sheet.tsx). Correcting a logged set is the opposite case. It rewrites
 * something already done, so it should read as a separate place, and a stray
 * tap on another row should not quietly abandon the draft. So this one is
 * modal: a scrim over the whole screen, tab bar included.
 *
 * A native `<dialog>` opened with `showModal()`, for the same reason as the
 * coach's Dialog (components/ui/dialog.tsx): the page behind goes inert and out
 * of the accessibility tree, focus stays inside, Escape and Android's back
 * gesture arrive as `cancel`, and it sits in the top layer above the shell.
 * What is added is the scrim (a tap on it is a dismiss request) and focus
 * going back to the row that opened it.
 *
 * `onDismiss` is a request, not a close. The screen decides: an untouched
 * draft closes, a changed one asks "Discard changes?" first. Cancel and Save
 * inside the sheet do not come through here; they mean what they say.
 *
 * Motion (docs/athlete-motion.md): the scrim fades in on `fade-in` and out on
 * `fade-out`; the panel rises on `sheet-in` and leaves on `sheet-out`, behind
 * `motion-safe:`. Leaving closes the modal at once, so the page is live and
 * focus is back before the slide has started, and the dialog is left open
 * non-modally, inert, only for the paint to finish.
 */

export interface ModalSheetProps {
  /** What the sheet holds. Null or false closes it. */
  children: ReactElement | null | false;
  /** The dialog's accessible name. */
  label: string;
  /** A tap on the scrim, Escape, or the platform's back: asks to close. */
  onDismiss: () => void;
  /** The row to keep visible above the sheet, as LogSheet does. */
  anchor?: RefObject<Element | null>;
  /** Changes when the field being edited changes. */
  revealKey?: string | null;
}

/** Focus back to whoever had it when the sheet opened, once. */
function handBack(opener: { current: HTMLElement | null }) {
  const to = opener.current;
  opener.current = null;
  if (to && to.isConnected) to.focus();
}

export function ModalSheet({ children, label, onDismiss, anchor, revealKey = null }: ModalSheetProps) {
  const { shown, leaving, exited } = usePresence(children);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** Whether it is open as a modal, as opposed to open only to finish leaving. */
  const modal = useRef(false);
  const mounted = shown !== null;

  useEffect(() => {
    const element = dialog.current;
    if (!mounted || !element) return;
    if (leaving) {
      if (modal.current && typeof element.close === "function") element.close();
      modal.current = false;
      // Painted, not modal: the page is live again while the panel slides
      // away. The attribute rather than show(), which would move focus in.
      element.setAttribute("open", "");
      handBack(opener);
      return afterExit(panel.current, exited);
    }
    opener.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modal.current) return;
    // jsdom has no showModal; the attribute is the same dialog, just not modal.
    if (typeof element.showModal === "function") {
      // Reopened mid-exit: open non-modally, so showModal would throw.
      if (element.open) element.close();
      element.showModal();
      modal.current = true;
    } else {
      element.setAttribute("open", "");
    }
    // `exited` is a fresh closure each render; the exit starts once per leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, mounted]);

  // Closed for good when it unmounts, and focus handed back if it has not been.
  useEffect(() => {
    if (!mounted) return;
    const element = dialog.current;
    return () => {
      if (element && typeof element.close === "function" && element.open) element.close();
      modal.current = false;
      handBack(opener);
    };
  }, [mounted]);

  const open = Boolean(children);
  useEffect(() => {
    if (!open || !panel.current || !anchor) return;
    revealAboveSheet(anchor.current, panel.current);
  }, [open, revealKey, anchor]);

  if (!shown) return null;
  return (
    // Escape arrives as both a keydown and the dialog's `cancel`; asking twice
    // is harmless, because the screen's answer is the same both times.
    <dialog
      ref={dialog}
      aria-label={label}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
      data-modal-sheet=""
      onCancel={(event) => {
        // Kept open until the screen says otherwise: a changed draft asks first.
        event.preventDefault();
        onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        }
      }}
      className={
        // Full-screen and see-through: the scrim and the panel are children,
        // so both animate under the athlete-motion floor, and both still paint
        // while the dialog is open non-modally to leave.
        "fixed inset-0 z-50 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent"
      }
    >
      {/* Pointer only: Escape and Cancel are the keyboard's ways out. */}
      <div
        aria-hidden
        data-scrim=""
        onClick={onDismiss}
        className={cn("absolute inset-0 bg-black/70", leaving ? "animate-fade-out" : "animate-fade-in")}
      />
      <div
        ref={panel}
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-env(safe-area-inset-top,0px)-1rem)] flex-col",
          "overflow-y-auto overscroll-contain rounded-t-card border-t border-border bg-surface pb-safe",
          leaving ? "motion-safe:animate-sheet-out" : "motion-safe:animate-sheet-in",
        )}
      >
        {shown}
      </div>
    </dialog>
  );
}
