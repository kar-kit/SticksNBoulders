"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { panelSearch, readPanel, type AthletePanel } from "@/lib/coach/athlete-panel";

/**
 * The Athlete View's open overlay, read from and written to the URL.
 *
 * `window.history` rather than `router.push`: Next integrates the native
 * history calls with `useSearchParams` (node_modules/next/dist/docs, "Native
 * History API"), and a router push to the same page would ask the server for
 * a fresh payload only to open a dialog whose data is already on screen.
 *
 * Closing goes BACK when this page opened the panel, so Back and Close leave
 * the same history -- open, close, Back takes the coach to wherever they were
 * before the athlete, not into the dialog again. A panel that arrived in the
 * URL (a reload, a pasted link) has nothing of ours behind it to go back to,
 * so closing that one replaces the entry instead of leaving the app.
 */
export function useAthletePanel(): {
  panel: AthletePanel | null;
  open: (panel: AthletePanel) => void;
  close: () => void;
} {
  const params = useSearchParams();
  const pathname = usePathname();
  const panel = useMemo(() => readPanel(params), [params]);
  const pushed = useRef(false);

  // The browser's own Back closed it: whatever we pushed is gone, and the
  // next close must not go back a second time.
  useEffect(() => {
    if (!panel) pushed.current = false;
  }, [panel]);

  const open = useCallback(
    (next: AthletePanel) => {
      // Already showing one we pushed: swap it in place rather than stacking
      // entries Back would have to walk through.
      const method = pushed.current ? "replaceState" : "pushState";
      window.history[method](null, "", `${pathname}${panelSearch(window.location.search, next)}`);
      pushed.current = true;
    },
    [pathname],
  );

  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", `${pathname}${panelSearch(window.location.search, null)}`);
  }, [pathname]);

  return { panel, open, close };
}
