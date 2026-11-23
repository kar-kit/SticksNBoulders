import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Landing } from "./landing";
import { Hero } from "@/components/landing/hero";
import { HeroPoster } from "@/components/landing/hero-poster";
import { buttonClass } from "@/components/ui/button";
import { RETURNING_SCRIPT } from "@/lib/landing/root";
import { SHOTS, type Shot } from "@/lib/landing/shots";

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
 *
 * Laid out as a ruled ledger: one bordered frame, hairline rules between rows
 * and cells, a mono label in a left rail. The product is a training log and
 * the thing it replaces is a spreadsheet, so the page reads like one. One
 * border colour, no cards, no shadows, no gradients.
 */
export default function Home() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: RETURNING_SCRIPT }} />
      <Landing />
      <div className="landing-page min-h-dvh px-0 lg:px-6 lg:py-6">
        <div className="mx-auto w-full max-w-[1200px] border-border lg:border">
          <header className="flex items-center justify-between border-b border-border px-5 pt-[max(12px,env(safe-area-inset-top))] pb-3 lg:px-6">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-line"
            >
              <Image src="/mark-transparent.png" alt="" width={32} height={32} priority className="size-8 object-contain" />
              <span className="text-title font-semibold">Sticks N Boulders</span>
            </Link>
            <div className="flex items-center gap-5">
              <span className="hidden font-mono text-label uppercase text-muted-2 sm:inline">Private beta</span>
              <Link href="/sign-in" className={buttonClass({ variant: "secondary", size: "sm", className: "hover:bg-surface-2" })}>
                Sign in
              </Link>
            </div>
          </header>

          <main>
            <section aria-labelledby="promise" className="grid lg:grid-cols-[1fr_1.1fr]">
              <div className="flex flex-col justify-center border-b border-border px-5 py-10 lg:border-r lg:border-b-0 lg:px-10 lg:py-16">
                <p className="font-mono text-label uppercase text-muted-2">Powerlifting coaching software</p>
                <h1 id="promise" className="mt-4 text-hero font-bold lg:text-[58px]">
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
                  <a href="#joining" className="text-ui text-muted underline underline-offset-4 hover:text-foreground">
                    How athletes join
                  </a>
                </div>
                <p className="mt-4 text-note text-muted-2">Athletes join with their coach&rsquo;s invite code.</p>
              </div>
              <div className="flex items-center px-5 py-6 lg:px-8">
                <div className="w-full">
                  <Hero>
                    <HeroPoster className="block h-full w-full" />
                  </Hero>
                </div>
              </div>
            </section>

            <Row id="coach" label="Coach" where="Laptop, keyboard first" title="The coach's screen">
              <Figure shot={SHOTS.roster} />
              <Spec className="border-t border-border">
                <Item what="Needs you">
                  The roster opens on who needs you: videos you have not reviewed first, then an RPE 10 you did not
                  ask for, sessions missed this week, and anyone who has not weighed in for seven days.
                </Item>
                <Item what="Video">
                  Every clip from every athlete in one queue, next to the set it came from: load, reps, RPE and what you
                  prescribed. Your comment stays on that set.
                </Item>
                <Item what="Bodyweight">Athletes log it in the app. The trend sits on their page.</Item>
                <Item what="Export">Any athlete&rsquo;s full log as CSV. Keep the spreadsheet if you want it.</Item>
              </Spec>
              <Figure shot={SHOTS.program} className="border-t border-border" />
              <Spec className="border-t border-border">
                <Item what="Prescriptions">
                  Typed the way you would say them: <Code>142.5</Code>, <Code>75%</Code>, <Code>@8</Code>, or{" "}
                  <Code>75% @8</Code> for a percentage capped at RPE 8. Kilos show next to the percentage. Anything it
                  does not recognise is kept as you typed it.
                </Item>
              </Spec>
            </Row>

            <Row id="athlete" label="Athlete" where="Phone, one hand, mid-set" title="The athlete's phone">
              <div className="grid grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
                <Figure shot={SHOTS.today} className="border-r border-border" />
                <Figure shot={SHOTS.log} className="lg:border-r lg:border-border" />
                <Spec className="col-span-2 border-t border-border lg:col-span-1 lg:border-t-0">
                  <Item what="Today">The session your coach wrote, with percentages already turned into kilos.</Item>
                  <Item what="Offline">
                    A set saves to the phone first and syncs when you are back upstairs. Nothing waits on the network.
                  </Item>
                  <Item what="Video">Film the set and the clip stays with it. If the wifi drops, the upload carries on.</Item>
                  <Item what="Numbers">
                    Each set gets an estimated max when you log it. New records are marked when you finish.
                  </Item>
                  <Item what="Typing">
                    Start typing an exercise and pick it, or add your own. If your coach switches it on, the next
                    set&rsquo;s load is suggested from the RPE you just logged.
                  </Item>
                  <Item what="Install">No app store. Add it to your home screen from the browser.</Item>
                </Spec>
              </div>
            </Row>

            <Row id="joining" label="Joining" where="One code per coach" title="How athletes join">
              <ol className="grid lg:grid-cols-3">
                <Step n={1} className="lg:border-r">
                  The coach creates an account, chooses Coach, and gets an invite code like <Code>SNB-4F7K2</Code>.
                </Step>
                <Step n={2} className="border-t border-border lg:border-t-0 lg:border-r">
                  The athlete creates their own account and enters the code. No logins to hand out.
                </Step>
                <Step n={3} className="border-t border-border lg:border-t-0">
                  The athlete sees the coach&rsquo;s name and confirms. From then on the coach sees their training and
                  the athlete sees the program.
                </Step>
              </ol>
            </Row>

            <Row id="not" label="Not" where="On purpose" title="What it does not do">
              <Spec>
                <Item what="Coaching">
                  There is no AI coach. The software takes the admin off the coach; the coaching stays with the coach.
                </Item>
                <Item what="Social">It is a training log and a coaching tool. No public profiles, rankings or sharing.</Item>
              </Spec>
            </Row>

            <section aria-labelledby="now" className="grid border-t border-border lg:grid-cols-[1fr_auto]">
              <div className="px-5 py-10 lg:border-r lg:border-border lg:px-10 lg:py-12">
                <h2 id="now" className="text-display font-semibold">
                  Where it is now
                </h2>
                <p className="mt-3 max-w-[38rem] text-body text-muted">
                  In private beta with one powerlifting coach and their athletes, and built around how they train. If
                  your coach has given you a code, you can start today.
                </p>
              </div>
              <div className="flex items-center border-t border-border px-5 py-8 lg:border-t-0 lg:px-10">
                <Link href="/sign-in" className={buttonClass({ size: "xl", className: "hover:opacity-90" })}>
                  Sign in or create an account
                </Link>
              </div>
            </section>
          </main>

          <footer className="flex items-center justify-between border-t border-border px-5 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] text-note text-muted-2 lg:px-6">
            <span>&copy; 2026 Sticks N Boulders</span>
            <Link href="/sign-in" className="inline-flex h-11 items-center hover:text-foreground">
              Sign in
            </Link>
          </footer>
        </div>
      </div>
    </>
  );
}

/**
 * One row of the ledger: a rail cell with the section's mono label, and the
 * content beside it. On a phone the rail becomes a strip across the top.
 */
function Row({
  id,
  label,
  where,
  title,
  children,
}: {
  id: string;
  label: string;
  where: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-6 border-t border-border lg:grid-cols-[200px_1fr]">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-3 lg:block lg:border-r lg:border-b-0 lg:px-6 lg:py-6">
        <p className="font-mono text-label uppercase text-foreground">{label}</p>
        <p className="font-mono text-label uppercase text-muted-2 lg:mt-2">{where}</p>
      </div>
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="border-b border-border px-5 py-5 text-display font-semibold lg:px-8">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

/** A screenshot in a bordered cell, with a caption bar underneath. Demo data, and it says so. */
function Figure({ shot, className = "" }: { shot: Shot; className?: string }) {
  return (
    <figure className={`m-0 flex flex-col ${className}`}>
      <div className={`flex flex-1 items-start justify-center bg-background ${shot.phone ? "px-4 pt-4 lg:px-6 lg:pt-6" : "px-5 pt-5 lg:px-8 lg:pt-8"}`}>
        {/* A desktop screen is small on a phone: tapping opens it at full size. */}
        <a
          href={shot.src}
          className={`block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line ${shot.phone ? "w-full max-w-[260px]" : "w-full"}`}
        >
          <Image
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            sizes={shot.phone ? "(min-width: 1024px) 260px, 45vw" : "(min-width: 1024px) 900px, 100vw"}
            className="h-auto w-full border border-border"
          />
        </a>
      </div>
      <figcaption
        className={`mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border py-2.5 ${shot.phone ? "px-4 lg:px-6" : "px-5 lg:px-8"}`}
      >
        <span className="font-mono text-label uppercase text-foreground">{shot.caption}</span>
        <span className="font-mono text-label uppercase text-muted-2">Demo data</span>
      </figcaption>
    </figure>
  );
}

/** A ruled two-column spec: what, then how, one hairline between each. */
function Spec({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`m-0 divide-y divide-border ${className}`}>{children}</dl>;
}

function Item({ what, children }: { what: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-4 px-5 py-4 lg:grid-cols-[110px_1fr] lg:px-8">
      <dt className="pt-0.5 font-mono text-label uppercase text-muted-2">{what}</dt>
      <dd className="m-0 max-w-[62ch] text-body text-muted">{children}</dd>
    </div>
  );
}

function Step({ n, children, className = "" }: { n: number; children: ReactNode; className?: string }) {
  return (
    <li className={`border-border px-5 py-6 lg:px-8 ${className}`}>
      <p className="font-mono text-label uppercase text-muted-2">Step {n}</p>
      <p className="mt-3 text-body">{children}</p>
    </li>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="whitespace-nowrap rounded-chip border border-border bg-surface px-1.5 py-0.5 font-mono text-note text-foreground">
      {children}
    </code>
  );
}
