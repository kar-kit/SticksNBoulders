"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { railName } from "@/lib/auth/role";
import { UserAvatar } from "@/components/profile/user-avatar";
import { useRequireSession } from "@/lib/auth/session-context";
import { useChanged } from "@/components/ui/motion";

/**
 * The coach shell. Desktop first, but it has to work on a phone too: Ruairi
 * reported it broken on mobile in October 2026. Below md the nav drops to its
 * own row and the athlete rail becomes a scrolling strip; nothing is
 * duplicated in the DOM.
 *
 * The athlete rail is persistent on every coach screen, so switching between
 * people never costs a round trip through a menu. The review count in the top
 * nav is the one number Ruairi should see the moment he opens a tab.
 *
 * Motion (docs/coach-motion.md): the active section's rule grows in under it,
 * links answer hover and keyboard focus alike, and the review count pops when
 * it changes while the coach is elsewhere -- the reason it is in the nav.
 */

export interface CoachAthlete {
  id: string;
  name: string;
  /** Draws the accent dot: this person needs something. */
  needsAttention?: boolean;
  /** Their picture, if they have one. Also in the avatar registry. */
  avatarFileId?: string | null;
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
    return <div className="coach-scale bg-background" aria-busy={state.status === "loading"} />;
  }

  const { user } = state;

  return (
    <div className="coach-scale flex flex-col bg-background">
      {/* Phone: brand and account on one row, the nav on its own full-width
          row under them, sized for a thumb. md and up: one 56px row. */}
      <header className="pt-safe flex flex-none flex-wrap items-center gap-x-7 border-b border-border px-4 md:h-14 md:flex-nowrap md:px-5 md:pt-0">
        <Link href="/coach/roster" className="flex h-14 items-center gap-2.5 md:h-auto">
          <Image src="/mark-transparent.png" alt="" width={24} height={24} className="size-6 object-contain" />
          <span className="hidden text-ui font-semibold tracking-[0.02em] sm:inline">Sticks N Boulders</span>
        </Link>
        <nav
          aria-label="Coach"
          className="order-last -mx-2 grid basis-full grid-cols-3 gap-1 pb-2 md:order-none md:mx-0 md:flex md:basis-auto md:items-center md:pb-0"
        >
          {NAV.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center justify-center gap-[7px] overflow-hidden rounded-chip px-3 text-ui md:h-8 md:justify-start",
                  "transition-control press rule-b aria-[current=page]:rule-on",
                  active
                    ? "bg-surface-2 font-semibold text-foreground"
                    : "text-muted hover:bg-surface-2/60 hover:text-foreground focus-visible:bg-surface-2/60 focus-visible:text-foreground",
                )}
              >
                {label}
                {label === "Review" && reviewCount ? <ReviewCount count={reviewCount} /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3.5">
          {/* One account, two modes. Role is a relationship, so a coach who
              lifts uses the same account rather than a second one. */}
          <button
            type="button"
            onClick={() => router.push("/today")}
            className="flex h-[30px] items-center rounded-chip border border-border px-3 text-sm text-muted transition-control press hover:text-foreground focus-visible:text-foreground"
          >
            Athlete mode
          </button>
          <span className="hidden text-ui font-medium sm:inline">{user.name.split(" ")[0]}</span>
          <UserAvatar userId={user.id} name={user.name} size={28} />
        </div>
      </header>

      {/* The rail is a 180px column from md up. On a phone that would leave
          half the screen for the page, so it becomes one scrolling row of
          chips under the header instead: still on every screen, still one tap
          to switch person. Hidden there when empty; the Roster says so. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className={cn(
            "flex-none gap-1.5 overflow-x-auto border-b border-border px-4 py-2 [scrollbar-width:none]",
            "md:flex md:w-[180px] md:flex-col md:gap-0.5 md:overflow-x-visible md:border-r md:border-b-0 md:px-2 md:py-4",
            athletes.length === 0 ? "hidden" : "flex",
          )}
        >
          <div className="hidden px-2 pb-2.5 font-mono text-label text-muted-2 uppercase md:block">Athletes</div>
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
                    "flex h-9 flex-none items-center justify-between gap-2 rounded-chip border px-2.5 text-ui transition-control press-wide",
                    "md:border-transparent",
                    active
                      ? "border-transparent bg-surface-2 font-semibold"
                      : "border-border text-foreground hover:bg-surface-2/60 focus-visible:bg-surface-2/60",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar userId={athlete.id} name={athlete.name} size={20} />
                    <span className="max-w-[9rem] truncate md:max-w-none">{railName(athlete.name)}</span>
                  </span>
                  {athlete.needsAttention ? (
                    <span aria-label="Needs attention" className="block size-1.5 flex-none rounded-full bg-accent-line" />
                  ) : null}
                </Link>
              );
            })
          )}
        </aside>

        <main className="pb-safe min-w-0 flex-1 overflow-y-auto md:pb-0">{children}</main>
      </div>
    </div>
  );
}

/** The Review badge. A new number pops in, so a clip arriving mid-session is noticed. */
function ReviewCount({ count }: { count: number }) {
  const changed = useChanged(count);
  return (
    <span
      key={count}
      className={cn("font-mono text-caption font-medium text-accent-fill", changed && "motion-safe:animate-pop-in")}
    >
      {count}
    </span>
  );
}
