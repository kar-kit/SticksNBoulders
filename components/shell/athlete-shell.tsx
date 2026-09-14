"use client";

import { TabBar } from "@/components/ui/tab-bar";
import { useRequireSession } from "@/lib/auth/session-context";

/**
 * The athlete shell. A phone app that happens to open on a laptop.
 *
 * Content scrolls between a fixed safe area and the tab bar; the tab bar itself
 * never scrolls away, because a thumb reaching for it mid-set should not have
 * to find it first.
 *
 * The chrome renders immediately, before the session resolves. Resolving it
 * costs an Appwrite round trip -- 300ms on a slow connection -- and gating the
 * whole shell on that meant the app painted nothing at all in the meantime: no
 * first contentful paint, just a dark rectangle. Since almost every load of a
 * training logger is a signed-in one, showing the shell first and filling it in
 * is the honest trade. A signed-out visitor sees the chrome for one frame
 * before being redirected.
 */
export function AthleteShell({ children }: { children: React.ReactNode }) {
  const state = useRequireSession();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="pt-safe flex-none" />
      {/* 16px side gutters, per 00 Conventions. min-h-0 lets the scroll
          container actually scroll instead of growing the page. */}
      <main className="min-h-0 flex-1 overflow-y-auto px-4" aria-busy={state.status === "loading"}>
        {state.status === "signed-in" ? children : null}
      </main>
      <TabBar />
    </div>
  );
}
