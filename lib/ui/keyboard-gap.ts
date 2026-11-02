"use client";

import { useEffect } from "react";

/**
 * The keyboard-sized gap on an iPhone (F24).
 *
 * The athlete shell is pinned to the viewport (h-dvh, overflow hidden) and only
 * <main> scrolls, so the document itself never has anywhere to scroll to. iOS
 * WebKit scrolls it anyway: when an input low on the screen takes focus, it
 * shifts the window up to clear the keyboard. When the keyboard goes, it often
 * leaves that shift in place, and the shell sits a keyboard's height too high
 * with a blank band where the keyboard was. Joey hit it adding an exercise
 * from the Log page in the installed app.
 *
 * Nothing in the shell can scroll the document on purpose, so once no field
 * holds the keyboard any document scroll at all is that leftover, and putting
 * it back to the top is safe. Only the document: <main>'s own scroll is the
 * athlete's place in the list, and log-sheet moves it to keep the row being
 * typed into above the sheet.
 *
 * Not for the coach shell. There the document is the scroller (coach-scale is
 * a min-height, and the page grows past it), so a reset would throw a coach
 * back to the top of the program editor every time a field lost focus.
 */

/** Input types that never raise the keyboard: a tap on one is not typing. */
const NO_KEYBOARD = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether focus on `el` holds the on-screen keyboard up. A read-only or
 * disabled field does not, so it counts as somewhere the keyboard has closed.
 */
export function isEditable(el: Element | null | undefined): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof HTMLElement && el.isContentEditable === true;
}

/**
 * Takes focus off the field that holds the keyboard, if one does, so the
 * keyboard closes and a focusout fires while the field is still in the page.
 *
 * Call it before a state change that removes or abandons a focused field.
 * WebKit fires no focusout for a focused element that is simply unmounted,
 * and a typeahead option keeps focus on its input (its mousedown is
 * prevented, so the pick survives the tap), so without this the guard below
 * hears nothing until the viewport resizes.
 */
export function releaseKeyboard(doc: Document = document): void {
  const active = doc.activeElement;
  if (isEditable(active)) (active as HTMLElement).blur();
}

/**
 * Puts a document the keyboard left scrolled back at the top. True if it had
 * to. Never while a field still holds the keyboard: that scroll is iOS keeping
 * the field in view, and taking it away mid-word would jump the page under
 * the athlete's thumb.
 */
export function resetKeyboardScroll(win: Window = window): boolean {
  const doc = win.document;
  if (isEditable(doc.activeElement)) return false;
  const root = doc.scrollingElement;
  const rootTop = root?.scrollTop ?? 0;
  if (win.scrollY === 0 && rootTop === 0) return false;
  // Instant, never smooth: the band is already on screen, and a smooth scroll
  // would animate the whole shell sliding down into place.
  win.scrollTo(0, 0);
  // Both are read above because either one being off is the gap; set the
  // scrolling element directly too, in case scrollTo left it where it was.
  if (root && root.scrollTop !== 0) root.scrollTop = 0;
  return true;
}

/**
 * Clears the keyboard's leftover document scroll for as long as the calling
 * shell is mounted. Two triggers, because neither is enough on its own:
 *
 * - focusout, checked on the next frame, by which time focus has landed
 *   wherever it was going. Moving between two fields fires one too, and the
 *   frame's wait is what stops that from counting as the keyboard closing.
 * - the visual viewport resizing, which is the keyboard actually closing.
 *   It catches the exits that fire no focusout at all, such as a focused
 *   field unmounted by a re-render.
 *
 * A browser without visualViewport gets the focusout half alone.
 */
export function useKeyboardGapGuard(): void {
  useEffect(() => {
    let frame: number | null = null;
    const onFocusOut = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        resetKeyboardScroll();
      });
    };
    const onResize = () => resetKeyboardScroll();
    const viewport = window.visualViewport;

    document.addEventListener("focusout", onFocusOut);
    viewport?.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("focusout", onFocusOut);
      viewport?.removeEventListener("resize", onResize);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
}
