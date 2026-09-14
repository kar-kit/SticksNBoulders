"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { initialsFor, railName } from "@/lib/auth/role";
import { useRequireSession } from "@/lib/auth/session-context";

/**
 * The coach shell. A desktop tool that degrades to read-only on a phone.
 *
 * The athlete rail is persistent on every coach screen, so switching between
 * people never costs a round trip through a menu. The review count in the top
 * nav is the one number Ruairi should see the moment he opens a tab.
 */

export interface CoachAthlete {
  id: string;
  name: string;
  /** Draws the accent dot: this person needs something. */
  needsAttention?: boolean;
}

const NAV = [
  { href: "/coach/roster", label: "Roster" },
  { href: "/coach/review", label: "Review" },
  { href: "/coach/programs", label: "Programs" },
] as const;

export interface CoachShellProps {
  athletes: CoachAthlete[];
  /** Shown beside Review. Omitted entirely at zero -- a "0" is noise. */
  reviewCount?: number;
  children: React.ReactNode;
}

export function CoachShell({ athletes, reviewCount, children }: CoachShellProps) {
  const state = useRequireSession();
  const pathname = usePathname();
  const router = useRouter();

  if (state.status !== "signed-in") {
    return <div className="min-h-dvh bg-background" aria-busy={state.status === "loading"} />;
  }

  const { user } = state;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 flex-none items-center justify-between gap-7 border-b border-border px-5">
        <div className="flex items-center gap-7">
          <Link href="/coach/roster" className="flex items-center gap-2.5">
            <Image src="/mark-transparent.png" alt="" width={24} height={24} className="size-6 object-contain" />
            <span className="text-ui font-semibold tracking-[0.02em]">Sticks N Boulders</span>
          </Link>
          <nav aria-label="Coach" className="flex items-center gap-1">
            {NAV.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-[7px] rounded-chip px-3 text-ui",
                    active
                      ? "bg-surface-2 font-semibold text-foreground shadow-[inset_0_-2px_0_var(--accent-fill)]"
                      : "text-muted",
                  )}
                >
                  {label}
                  {label === "Review" && reviewCount ? (
                    <span className="font-mono text-caption font-medium text-accent-fill">{reviewCount}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3.5">
          {/* One account, two modes. Role is a relationship, so a coach who
              lifts uses the same account rather than a second one. */}
          <button
            type="button"
            onClick={() => router.push("/today")}
            className="flex h-[30px] items-center rounded-chip border border-border px-3 text-sm text-muted"
          >
            Athlete mode
          </button>
          <span className="text-ui font-medium">{user.name.split(" ")[0]}</span>
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-chip bg-surface-2 text-caption font-semibold text-muted"
          >
            {initialsFor(user.name)}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[180px] flex-none flex-col gap-0.5 border-r border-border px-2 py-4">
          <div className="px-2 pb-2.5 font-mono text-label text-muted-2 uppercase">Athletes</div>
          {athletes.length === 0 ? (
            <p className="m-0 px-2 text-sm leading-normal text-muted-2">Nobody yet.</p>
          ) : (
            athletes.map((athlete) => {
              const href = `/coach/athletes/${athlete.id}`;
              const active = pathname === href;
              return (
                <Link
                  key={athlete.id}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center justify-between rounded-chip px-2.5 text-ui",
                    active ? "bg-surface-2 font-semibold" : "text-foreground",
                  )}
                >
                  {railName(athlete.name)}
                  {athlete.needsAttention ? (
                    <span aria-label="Needs attention" className="block size-1.5 rounded-full bg-accent-line" />
                  ) : null}
                </Link>
              );
            })
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
