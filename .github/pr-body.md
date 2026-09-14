## FTP1-4 — Next.js PWA shell, routing and layout

**Notion:** https://app.notion.com/3da64699b43c81959c99f1de2aca37f3
**Depends on:** #1–#4 (all merged)

### What was built

Both shells from `00 — Conventions`, the route structure underneath them, and
the role switching between them.

- **Athlete shell** — four tabs, 16px gutters, safe areas top and bottom, tab
  bar outside the scroll region so a thumb never has to hunt for it.
- **Coach shell** — top nav with the review count, persistent 180px athlete
  rail on every screen, `Athlete mode` switch.
- **Route groups** `(athlete)` and `(coach)`, so the two surfaces are separate
  trees rather than one responsive app with breakpoints.
- **`SessionProvider`** — the session fetched once per app load, not per screen.

**Role is a relationship, not an account type.** There is no coach flag and
there never will be: `fetchCoachStatus` reads `coach_athlete_links`, and the
`Coach mode` button on Me appears and disappears on its own as links are made
and revoked. The e2e proves it by creating a real link mid-run and watching the
app notice.

### The bug this feature nearly shipped with

After signing in, `SessionProvider` still held `signed-out`. So the athlete
shell bounced back to `/sign-in`, which saw a valid Appwrite session and bounced
to `/today`, which bounced back — **two screens redirecting at each other about
thirty times a second, hammering Appwrite with 131 `/account` requests every
four seconds.**

Every unit test passed throughout. It only surfaced when Playwright reported
`element was detached from the DOM, retrying` thirteen times and I went looking.

The cause was two sources of session truth: the sign-in screen ran its own
`account.get()` alongside the provider. It now reads the provider, and callers
that are about to navigate await `refresh()` first. **After: 0 requests while
idle.**

### Decisions not specified

- **Sign-in lands on `/`, never on a surface.** The root is the only place that
  knows whether someone has athletes linked, so it is the only place that can
  route by role. Sending sign-in straight to `/today` put a coach in the athlete
  app with no signposted way out — caught by the e2e, not by a test I wrote.
- **The shell chrome paints before the session resolves.** Gating the whole
  shell meant no first contentful paint at all on a cold load: `FCP NaN`,
  a dark rectangle for a full Appwrite round trip. Measured, not guessed. Almost
  every load of a training logger is a signed-in one, so the shell renders first
  and fills in. A signed-out visitor sees chrome for one frame; their data never
  appears.
- **Every route in both navs exists**, including `/coach/review`,
  `/coach/programs` and `/coach/athletes/[id]`. Next prefetches nav links, and
  those were 404ing. Each shows the real empty state of the screen that will
  replace it — which is genuinely what Ruairi sees on an account with nothing on
  it, so none of it is throwaway copy.

### The load budget, measured

Order 4 sets it: interactive under 2.5s on 4G. `npm run perf:check` measures it
against a production build with a cold cache and Chrome's own throttling
presets, so it stays honest as screens land.

```
Fast 4G   /sign-in  FCP 440ms  interactive 385ms  load 783ms   57KB
          /today    FCP 444ms  interactive 388ms  load 798ms   54KB
Slow 4G   /sign-in  FCP 932ms  interactive 793ms  load 2327ms  57KB
          /today    FCP 924ms  interactive 807ms  load 2226ms  54KB
```

Interactive at **388ms on Fast 4G** against a 2500ms budget, and 807ms on Slow
4G. Slowness was Ruairi's first complaint about RTS; this is the number that has
to keep holding.

### Tests

34 new, 487 total, plus `npm run e2e:shell` — 15 assertions driving both shells
against the live instance with a real coach link, circle team and profile:

```
A plain athlete
  lands on Today / four-tab shell / each tab reaches its route
  no coach switch, because nobody is linked to them
  every screen has a real empty state, not a blank
Once an athlete is linked
  a coach lands on their roster, not on Today
  the rail names the athlete
  athlete mode switches on the same account, and the way back is on Me
Every link in the coach nav goes somewhere
```

### Also fixed

**The write guard crashed on a staged deletion.** It read every path `git
ls-files` reported, including files deleted from disk but still in the index —
a half-finished rebase turned a security check into a confusing `ENOENT` at the
worst possible moment. It skips missing paths now.

`appwrite/browser-client.ts` may construct `TablesDB` for **reads**. The
row-mutator ban still covers it, and that is the rule that matters — verified by
adding a bypassing file and watching the guard fail.

### Not in this PR

The service worker, install prompt and offline check are Order 40. The manifest
and icons are correct and serving; nothing caches offline yet.
