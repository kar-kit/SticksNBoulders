"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SCREEN_CLASS, animateTraversals, classifyNavigation } from "@/lib/ui/screen-transition";

/**
 * React's <ViewTransition>. It ships in the React canary that Next's App
 * Router bundles, which is what the app runs on. The plain `react` package
 * that vitest resolves does not export it, and neither would a future React
 * that dropped it; both get a pass-through, which is the same thing an
 * unsupported browser sees: the screen just changes.
 */
const ViewTransition = (React as unknown as { ViewTransition?: React.ComponentType<React.ViewTransitionProps> })
  .ViewTransition;

/** The pathname the screen last committed at. One per shell, read during render. */
function createCommittedPath() {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: string) {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Resolves once `pathname` has committed. */
    reached(pathname: string) {
      return new Promise<void>((resolve) => {
        if (value === pathname) return resolve();
        const check = () => {
          if (value !== pathname) return;
          listeners.delete(check);
          resolve();
        };
        listeners.add(check);
      });
    },
  };
}

const serverSnapshot = () => null;

/**
 * Wraps the athlete shell's <main> (the one scroll container every screen
 * renders in) so a route change slides or crossfades it. The shell's chrome is
 * outside it and the tab bar is its own named group, so neither moves.
 *
 * For links and router.push, the class is worked out in render, from the
 * pathname being committed and the one last committed: Next navigations are
 * transitions, and React reads `update` off the props of the commit that starts the view transition. After
 * the commit, the committed path catches up and the class drops back to
 * "none", so a later transition inside the screen (a Suspense reveal, a
 * useTransition) does not replay the slide.
 */
export function ScreenTransition({ children }: { children: React.ReactElement }) {
  const pathname = usePathname();
  const [committed] = useState(createCommittedPath);
  const previous = useSyncExternalStore(committed.subscribe, committed.get, serverSnapshot);

  const screenRef = useRef<HTMLElement | null>(null);

  // Back/forward: React renders them synchronously and never animates them,
  // so lib/ui/screen-transition.ts does (and skips what the browser animated).
  useEffect(
    () =>
      animateTraversals({
        committedPath: committed.get,
        waitForCommit: committed.reached,
        screen: () => screenRef.current,
      }),
    [committed],
  );
  // Layout effect: back/forward holds the old frame until this runs.
  useLayoutEffect(() => committed.set(pathname), [committed, pathname]);

  // The screen element (<main>), for the back/forward path above. The shell
  // puts no ref of its own on it.
  const child = React.cloneElement(children as React.ReactElement<{ ref?: React.Ref<HTMLElement> }>, {
    ref: screenRef,
  });
  if (!ViewTransition) return child;

  const motion = previous === null || previous === pathname ? "none" : classifyNavigation(previous, pathname);

  return (
    <ViewTransition name="athlete-screen" default="none" update={SCREEN_CLASS[motion]}>
      {child}
    </ViewTransition>
  );
}
