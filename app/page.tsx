import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Landing } from "./landing";
import { Hero } from "@/components/landing/hero";
import { HeroPoster } from "@/components/landing/hero-poster";
import { buttonClass } from "@/components/ui/button";
import { RETURNING_SCRIPT } from "@/lib/landing/root";

export const metadata = {
  title: "Sticks N Boulders: powerlifting coaching software",
  description:
    "Write the block on a laptop. Your athletes log it on their phones, offline if they have to. Sets, videos and bodyweight come back to you.",
};

/**
 * The front door. A signed-out visitor reads this; a signed-in one never sees
 * it, because `Landing` sends them on exactly as the root always has and the
 * inline script hides the page before first paint for anyone the device
 * remembers. Static, so it is served from the edge with no session lookup.
 *
 * Every claim on it is something the app does today. docs/landing-page.md
 * lists each one against the code or doc it comes from; keep the two in step.
 */
export default function Home() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: RETURNING_SCRIPT }} />
      <Landing />
      <div className="landing-page flex min-h-dvh flex-col">
        <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))] pb-4 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-line">
            <Image src="/mark-transparent.png" alt="" width={32} height={32} priority className="size-8 object-contain" />
            <span className="text-title font-semibold">Sticks N Boulders</span>
          </Link>
          <Link href="/sign-in" className={buttonClass({ variant: "secondary", size: "sm", className: "hover:bg-surface-2" })}>
            Sign in
          </Link>
        </header>

        <main className="flex-1">
          <section
            aria-labelledby="promise"
            className="mx-auto grid w-full max-w-[1120px] gap-8 px-5 pt-6 pb-14 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12 lg:px-8 lg:pt-14 lg:pb-24"
          >
            <div>
              <p className="font-mono text-label uppercase text-muted-2">Powerlifting coaching software</p>
              <h1 id="promise" className="mt-4 text-hero font-bold lg:text-[60px]">
                Write the block. See every set.
              </h1>
              <p className="mt-5 max-w-[34rem] text-subtitle text-muted">
                You write the training on a laptop. Your athletes log it on their phones, mid-session, signal or
                not. Their sets, videos and bodyweight come back to you, without a message thread.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href="/sign-in" className={buttonClass({ size: "xl", className: "hover:opacity-90" })}>
                  Sign in or create an account
                </Link>
                <a href="#linking" className="text-ui text-muted underline underline-offset-4 hover:text-foreground">
                  How athletes join
                </a>
              </div>
              <p className="mt-4 text-note text-muted-2">In private beta. Athletes join with their coach&rsquo;s invite code.</p>
            </div>
            <Hero>
              <HeroPoster className="block h-full w-full" />
            </Hero>
          </section>

          <section aria-labelledby="sides" className="border-t border-border bg-surface">
            <div className="mx-auto w-full max-w-[1120px] px-5 py-14 lg:px-8 lg:py-20">
              <h2 id="sides" className="text-display font-semibold">
                One account, two screens
              </h2>
              <p className="mt-3 max-w-[38rem] text-body text-muted">
                Most coaches lift too, so the same account does both. Switch sides from the header.
              </p>
              <div className="mt-10 grid gap-12 lg:grid-cols-2 lg:gap-16">
                <Side title="For the coach" where="Laptop, keyboard first">
                  <Point title="Type the prescription the way you would say it">
                    <Code>142.5</Code>, <Code>75%</Code>, <Code>@8</Code>, or <Code>75% @8</Code> for a percentage
                    capped at RPE 8. Kilos show next to the percentage. Anything it does not recognise is kept as you
                    typed it.
                  </Point>
                  <Point title="The roster opens on who needs you">
                    Videos you have not reviewed come first. Then an RPE 10 you did not ask for, sessions missed this
                    week, and anyone who has not weighed in for seven days.
                  </Point>
                  <Point title="Every clip in one queue">
                    Videos from every athlete, each next to the set it came from: load, reps, RPE and what you
                    prescribed. Your comment stays on that set, where the athlete reads it.
                  </Point>
                  <Point title="Bodyweight without asking">
                    Athletes log it in the app. The trend sits on their page.
                  </Point>
                  <Point title="Export to CSV">
                    Any athlete&rsquo;s full log, one file. Keep the spreadsheet if you want it.
                  </Point>
                </Side>
                <Side title="For the athlete" where="Phone, one hand, mid-set">
                  <Point title="Today is the session your coach wrote">
                    Percentages are already turned into kilos from your maxes.
                  </Point>
                  <Point title="Logging works with no signal">
                    A set saves to the phone first and syncs when you are back upstairs. Nothing waits on the network.
                  </Point>
                  <Point title="Film the set, the clip stays with it">
                    If the gym wifi drops, the upload carries on from where it stopped.
                  </Point>
                  <Point title="Your numbers, worked out as you go">
                    Each set gets an estimated max when you log it. New records are marked when you finish.
                  </Point>
                  <Point title="Type, never scroll">
                    Start typing an exercise and pick it, or add your own. If your coach switches it on, the next
                    set&rsquo;s load is suggested from the RPE you just logged.
                  </Point>
                  <Point title="No app store">
                    Add it to your home screen from the browser.
                  </Point>
                </Side>
              </div>
            </div>
          </section>

          <section aria-labelledby="linking-title" id="linking" className="scroll-mt-6 border-t border-border">
            <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-5 py-14 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-20">
              <div>
                <h2 id="linking-title" className="text-display font-semibold">
                  How athletes join
                </h2>
                <p className="mt-3 text-body text-muted">
                  No logins to hand out. Each athlete has their own account and links it to you with one code.
                </p>
              </div>
              <ol className="grid gap-6">
                <Step n={1}>
                  The coach creates an account, chooses Coach, and gets an invite code like <Code>SNB-4F7K2</Code>.
                </Step>
                <Step n={2}>The athlete creates their own account and enters the code.</Step>
                <Step n={3}>
                  The athlete sees the coach&rsquo;s name and confirms. From then on the coach sees their training
                  and the athlete sees the program.
                </Step>
              </ol>
            </div>
          </section>

          <section aria-labelledby="not" className="border-t border-border bg-surface">
            <div className="mx-auto w-full max-w-[1120px] px-5 py-14 lg:px-8 lg:py-20">
              <h2 id="not" className="text-display font-semibold">
                What it does not do
              </h2>
              <ul className="mt-8 grid max-w-[52rem] gap-8 lg:grid-cols-2 lg:gap-16">
                <Point title="Write your program">
                  There is no AI coach. The software takes the admin off the coach; the coaching stays with the coach.
                </Point>
                <Point title="Leaderboards or a feed">
                  It is a training log and a coaching tool. No public profiles, rankings or sharing.
                </Point>
              </ul>
            </div>
          </section>

          <section aria-labelledby="now" className="border-t border-border">
            <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-5 py-14 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-20">
              <div className="max-w-[36rem]">
                <h2 id="now" className="text-display font-semibold">
                  Where it is now
                </h2>
                <p className="mt-3 text-body text-muted">
                  In private beta with one powerlifting coach and their athletes, and built around how they train.
                  If your coach has given you a code, you can start today.
                </p>
              </div>
              <Link href="/sign-in" className={buttonClass({ size: "xl", className: "self-start hover:opacity-90 lg:self-auto" })}>
                Sign in or create an account
              </Link>
            </div>
          </section>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-5 pt-6 pb-[max(24px,env(safe-area-inset-bottom))] text-note text-muted-2 lg:px-8">
            <span>&copy; 2026 Sticks N Boulders</span>
            <Link href="/sign-in" className="inline-flex h-11 items-center hover:text-foreground">
              Sign in
            </Link>
          </div>
        </footer>
      </div>
    </>
  );
}

function Side({ title, where, children }: { title: string; where: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-heading font-semibold">{title}</h3>
      <p className="mt-1 font-mono text-label uppercase text-muted-2">{where}</p>
      <ul className="mt-6 grid gap-6">{children}</ul>
    </div>
  );
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <p className="text-title font-semibold">{title}</p>
      <p className="mt-1 text-body text-muted">{children}</p>
    </li>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-3">
      <span className="font-mono text-value-sm text-muted-2" aria-hidden="true">
        {n}
      </span>
      <p className="text-body">{children}</p>
    </li>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="whitespace-nowrap rounded-chip bg-surface-2 px-1.5 py-0.5 font-mono text-note text-foreground">{children}</code>;
}
