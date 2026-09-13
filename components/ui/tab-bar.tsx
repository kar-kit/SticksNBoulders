"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { HistoryIcon, LogIcon, MeIcon, TodayIcon } from "./icons";

/**
 * Four tabs, no more. Bodyweight, Lift Detail, My Program and Coach Feedback
 * are reached from inside these four. A fifth tab means something else is wrong.
 */
const TABS = [
  { href: "/today", label: "Today", Icon: TodayIcon },
  { href: "/log", label: "Log", Icon: LogIcon },
  { href: "/history", label: "History", Icon: HistoryIcon },
  { href: "/me", label: "Me", Icon: MeIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="pb-safe-nav grid flex-none grid-cols-4 border-t border-border bg-surface"
    >
      {TABS.map(({ href, label, Icon }) => {
        // Sub-routes keep their parent tab lit: /log/squat is still Log.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 62px tall, not content-height. This is the athlete's thumb nav:
              // a 35px target that happens to contain a 20px icon is a miss
              // waiting to happen. 62 + 14 bottom padding matches the canvas's
              // 76px nav, plus whatever the home indicator needs.
              "flex h-[62px] flex-col items-center justify-center gap-[5px]",
              active ? "text-accent-fill" : "text-muted-2",
            )}
          >
            <Icon />
            <span className={cn("text-label tracking-normal", active ? "font-semibold" : "font-medium")}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
