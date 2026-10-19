"use client";

import { useState } from "react";

/**
 * The few things coach-side motion needs that CSS cannot do by itself.
 *
 * Everything that moves is Tailwind: the tokens, keyframes and utilities in
 * app/globals.css. What CSS cannot do is know about React: that a row is new
 * rather than first-rendered, that a dialog React is about to remove should
 * stay long enough to leave, or that an animation already played should play
 * again. These are those, and nothing else -- no timing lives here, every
 * duration is read back from the stylesheet. docs/coach-motion.md.
 */

export type FlashKind = "saved" | "failed" | "landed";

/**
 * Plays the `flash-host` tint on an element: "saved", "didn't save", "you
 * landed here". Writes `data-flash`, and clears it when the tint's animation
 * ends so the next flash on the same element plays again. When one is already
 * showing it is restarted on the next frame rather than by forcing a layout.
 */
export function flash(el: Element | null | undefined, kind: FlashKind): void {
  if (!el) return;
  const start = () => {
    el.setAttribute("data-flash", kind);
    const done = (event: Event) => {
      if (event.target !== el) return;
      el.removeEventListener("animationend", done);
      if (el.getAttribute("data-flash") === kind) el.removeAttribute("data-flash");
    };
    el.addEventListener("animationend", done);
  };
  if (!el.hasAttribute("data-flash")) return start();
  el.removeAttribute("data-flash");
  requestAnimationFrame(start);
}

/**
 * How long the element's current exit takes, read from its computed style:
 * the longest animation or transition on it. Zero in jsdom, under reduced
 * motion (globals.css collapses everything to 0.01ms) and when nothing is
 * set, which is when a leaving element should simply go.
 */
export function exitDuration(el: Element | null | undefined): number {
  if (!el || typeof window === "undefined") return 0;
  const style = window.getComputedStyle(el);
  const longest = (durations: string, delays: string) => {
    const ds = durations.split(",").map(seconds);
    const ls = delays.split(",").map(seconds);
    return Math.max(0, ...ds.map((d, i) => d + (ls[i % ls.length] ?? 0)));
  };
  const total = Math.max(
    style.animationName && style.animationName !== "none" ? longest(style.animationDuration, style.animationDelay) : 0,
    longest(style.transitionDuration || "0s", style.transitionDelay || "0s"),
  );
  return total > 1 ? total : 0;
}

function seconds(value: string): number {
  const v = value.trim();
  if (!v) return 0;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return v.endsWith("ms") ? n : n * 1000;
}

/**
 * Calls `done` once the element has finished leaving: on its own
 * animationend / transitionend, or after its computed duration if neither
 * arrives (a tab in the background, an interrupted animation). At once when
 * there is nothing to wait for. Returns a cancel.
 */
export function afterExit(el: Element | null | undefined, done: () => void): () => void {
  const ms = exitDuration(el);
  if (!el || ms === 0) {
    done();
    return () => {};
  }
  let finished = false;
  const finish = (event?: Event) => {
    if (finished || (event && event.target !== el)) return;
    finished = true;
    cleanup();
    done();
  };
  const timer = window.setTimeout(finish, ms + 50);
  el.addEventListener("animationend", finish);
  el.addEventListener("transitionend", finish);
  const cleanup = () => {
    window.clearTimeout(timer);
    el.removeEventListener("animationend", finish);
    el.removeEventListener("transitionend", finish);
  };
  return () => {
    finished = true;
    cleanup();
  };
}

/**
 * Keeps something on screen while it leaves.
 *
 * Callers render "open" as "mounted" (the dialogs are driven by the URL), so
 * the moment it closes React would remove it and there would be nothing left
 * to animate. This holds on to the last value for as long as the leaving
 * element takes -- the element calls `exited` when its exit has played (see
 * `afterExit`) -- and says it is `leaving` meanwhile, which the element uses
 * to stop being interactive and to play its exit. A value that comes back
 * mid-exit cancels the exit.
 */
export function usePresence<T>(value: T | null | undefined | false): {
  shown: T | null;
  leaving: boolean;
  exited: () => void;
} {
  const current = value === false || value === undefined ? null : value;
  const [held, setHeld] = useState<T | null>(current);
  // Storing what was last rendered: React's own pattern for state derived
  // from a changing prop (react.dev, "Storing information from previous renders").
  if (current !== null && current !== held) setHeld(current);
  const leaving = current === null && held !== null;
  return {
    shown: current ?? held,
    leaving,
    exited: () => setHeld(null),
  };
}

/**
 * Which of a list's ids arrived after it first rendered: a line just added,
 * a week just duplicated, a clip put back. Those animate in; the rows that
 * were simply there when the screen opened do not, because a grid of forty
 * cells rising in on every page load is motion for its own sake.
 *
 * `scope` resets it without marking anything new -- switching to another
 * week replaces the list, it does not add to it.
 *
 * An id stays "new" until the list changes again, so its class is still on
 * the element when the animation finishes rather than removed halfway.
 */
export function useArrivals(ids: readonly string[], scope: string = ""): (id: string) => boolean {
  const key = `${scope}\u0000${ids.join("\u0000")}`;
  const [seen, setSeen] = useState(() => ({ key, scope, known: new Set(ids), fresh: new Set<string>() }));
  if (seen.key !== key) {
    const sameScope = seen.scope === scope;
    const fresh = sameScope ? new Set(ids.filter((id) => !seen.known.has(id))) : new Set<string>();
    setSeen({ key, scope, known: sameScope ? new Set([...seen.known, ...ids]) : new Set(ids), fresh });
  }
  return (id: string) => seen.fresh.has(id);
}

/**
 * True once `value` has changed since this component mounted: a week's state
 * going Draft to Live, a load line resolving to kilos. Paired with a `key` on
 * the value at the call site, so each change remounts the element and its
 * animation plays again, while the first render plays nothing.
 */
export function useChanged<T>(value: T): boolean {
  const [state, setState] = useState({ value, changed: false });
  if (!Object.is(state.value, value)) setState({ value, changed: true });
  return state.changed;
}
