"use client";

import Link from "next/link";
import { TabBar } from "@/components/ui/tab-bar";
import { COACH_HOME } from "@/lib/auth/destinations";
import { canCoach } from "@/lib/auth/mode";
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
  const coaching = state.status === "signed-in" && canCoach(state.prefs, state.coach.isCoach);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="pt-safe flex-none" />
      {/* The way back to the roster, on every athlete screen, for anyone who
          coaches. Not a fifth tab: athletes who never coach never see it.
          Mirrors the always-visible "Athlete mode" in the coach header; a
          coach with no athletes yet would otherwise have to type the URL. */}
      {coaching ? (
        <div className="flex flex-none justify-end px-4 pt-2">
          <Link
            href={COACH_HOME}
            className="flex h-[30px] items-center rounded-chip border border-border px-3 text-sm text-muted"
          >
            Coach mode
          </Link>
        </div>
      ) : null}
      {/* 16px side gutters, per 00 Conventions. min-h-0 lets the scroll
          container actually scroll instead of growing the page. */}
      {/*
        A flex column, so a screen can put its primary action in the thumb zone
        with mt-auto. min-h-full on the child does not work here: main's height
        comes from flex rather than being a definite value, so a percentage
        min-height resolves to nothing and the button rides up under the text.
      */}
      <main
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
        aria-busy={state.status === "loading"}
      >
        {state.status === "signed-in" ? children : null}
      </main>
      <TabBar />
    </div>
  );
}
