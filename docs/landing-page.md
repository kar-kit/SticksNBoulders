# The public landing page

_Written 28 Oct 2026, branch `landing-page`. The root `/` used to be a blank
dark screen that redirected: signed in went to the app, signed out went to
`/sign-in`. There was no front door. This doc holds the research behind the
page, the review of it, what it says and why, and the hero._

Labels follow CLAUDE.md: **[Fact]** with a source, **[Inference]** with the
reasoning, **[Unverified]** with what would confirm it.

---

## 1. Three pages studied

All three fetched live on **28 Oct 2026, 19:04 to 19:05 UTC**, with headless
Chromium (Playwright 1.63) at 1440×900 and 390×844. None blocked the fetch.
Screenshots are in `/tmp/snb-landing-research/` on Joey's machine (not
committed). Load figures are one cold run each on a home connection: rough, not
a benchmark.

| | Why this one | URL | Load event | Requests (scripts) | Weight |
| --- | --- | --- | --- | --- | --- |
| **TrueCoach** | The best-known coach-facing platform; the shape a coach expects coaching software to take | https://truecoach.co/ | 505 ms | 108 (38) | ~4.5 MB |
| **Hevy** | The athlete logger the athletes already use, and the closest thing to Strong; it sets the bar for "an app I will actually open" | https://www.hevyapp.com/ | 1,464 ms | 64 (1) | ~1.2 MB |
| **JuggernautAI** | Powerlifting-specific, and the "AI coach" product SNB is defined against | https://www.juggernautai.app/ | 1,004 ms | 82 (18) | [Unverified]: 76 of 82 resources hid their size; the screenshot suggests several MB of photography |

### TrueCoach

**First screen says:** "#1 Platform Built For Personal Trainers", trusted by
16,000+ coaches, email field plus **TRY IT FREE**.
**Aimed at:** personal trainers and gym owners. Athletes are "clients".
**Coach/athlete split:** coach-first throughout. The athlete appears once, as
"the free TrueCoach mobile app", in a tabbed section near the bottom.

**Structure:** promo bar · hero with email capture and a testimonial card ·
logo strip · nine-tile feature grid (Program Builder, Nutrition, Payments,
Custom Theming...) · screenshot band · four benefit cards · stat counters ·
trial CTA · SEO prose block · athlete-app tabs · three named testimonials ·
blog cards · trial CTA · footer with G2/Capterra badges.

**Good**
- The trial CTA is in the hero with "No credit card required / Cancel any time"
  beside it.
- The Compliance Tracking tile says how the number is computed: "7, 30, and
  90-day compliance rate… exercises completed vs. the number of exercises
  assigned". The only feature copy on the page a sceptic could check.
- Named testimonials with faces.

**Weak**
- The proof contradicts itself: "trusted by 16,000+ coaches" in the hero,
  "trusted by over 20,000+ personal trainers, coaches, and gym owners" just
  under it [Fact, page text].
- The stat counters rendered as **"0K+ TOTAL COACHES / 0K+ TOTAL CLIENTS"** in
  the capture. They animate in with JavaScript and had not fired [Fact,
  screenshot and DOM]. A visitor whose script fails sees zeros.
- On a phone the cookie modal covers the H1 and the CTA [Fact,
  `truecoach-mobile-first.png`].
- Headings written for search, not people: "Spend More Time On Coaching Your
  Clients At Scale And Less Time On Admin With The Best Personal Training
  Software".
- Nine equal tiles, each with "Learn More": a feature dump with no priority.
- 4.5 MB for a marketing page. Purple gradient and a stock photo of a smiling
  trainer.

### Hevy

**First screen says:** "Log Workouts / Get Stronger / Stay Motivated", free
for iOS and Android, store badges, "Loved by 17+ million athletes", 4.9 rating
from 630,000+ ratings.
**Aimed at:** general gym-goers.
**Coach/athlete split:** athlete only. Coaching is a nav link to a separate
site, hevycoach.com.

**Structure:** hero with a phone and watch mockup · "Featured on" press logos ·
four alternating feature blocks (log, progress, community, watch), each a
checklist · store-badge CTA · help accordion · SEO guide cards. Several bands
below that rendered empty in the capture and no footer appeared [Unverified:
may be lazy content the headless run did not trigger].

**Good**
- The hero image is the product doing its job: a real set row with the previous
  session's numbers ghosted in. It sells logging speed without a sentence.
- The cleanest phone first screen of the three: H1, one-line description,
  both store badges and the rating, no cookie wall [Fact, screenshot].
- One script on the page.
- Checklist items are concrete: "Mark Warmup, Drop, and Failure Sets",
  "Workout Offline".

**Weak**
- "#1 workout tracker" and "17+ million athletes" cannot be checked. The store
  rating can.
- The H1 could belong to any tracker on the market.
- The bottom third is SEO articles.

### JuggernautAI

**First screen says:** "The Smartest Program For You", 250,000+ users, "like
having the best coach in the world with you during every training session",
**Start Your Free Trial**.
**Aimed at:** self-coached powerlifters and powerbuilders.
**Coach/athlete split:** none. There is no coach customer; the product sells
itself as the coach's replacement.

**Structure:** hero card · "Who we are, since 2009" · meet photo · three-step
carousel · feature carousel (Meet Day Advisor, RPE tools, 300+ exercises...) ·
rating banner · pricing ($34.99/mo, $349.99/yr) · benefits · testimonial names
with a video pane · articles · FAQ · footer.

**Good**
- Speaks the sport: Meet Day Advisor for attempt selection, an RPE calculator,
  a warm-up planner with plate maths, an FAQ on peaking blocks "from 4+ weeks".
- Real competition photography, dark and high-contrast.
- Pricing on the home page.

**Weak**
- The page disagrees with itself: "300+ Exercises" sits above "With over 250
  exercises"; "250,000+ users" in the hero, "tens of thousands of athletes" two
  sections down; the "In-Depth History" body repeats the exercises paragraph
  word for word; the footer says "© 2023" [Fact, page text].
- "Smartest", "cutting-edge technology", "highest rated", and a "$2400+ value"
  badge on a $34.99 plan.
- Features sit in carousels, so most are behind arrows.
- On a phone a cookie banner takes the bottom 45% of the first screen and the
  CTA falls below it [Fact, screenshot].

---

## 2. Council review

Each page was read through three lenses separately. Findings are grouped by
lens, then rolled up without averaging the disagreements away.

### The lenses

**(a) The coach.** A powerlifting coach deciding whether to trust this with
their athletes. Built only from what the repo records about Ruairi:
- He left RTS, and his first and loudest complaint was load time [Fact,
  CLAUDE.md].
- Managing a login per athlete was a pain [Fact, CLAUDE.md].
- He has to ask athletes what they weigh [Fact, docs/bodyweight.md].
- His review day is "Watch videos, analyse weaknesses and then adjust program
  accordingly" [Fact, his form answer of 6 Oct, quoted in docs/roster.md].
- Video review today is long WhatsApp messages [Fact, docs/review-queue.md and
  docs/comments.md].
- Excel keeps winning [Fact, docs/csv-export.md].

*Looks for:* the words he programs in (RPE, percentages, blocks); how athletes
get on; video and bodyweight handled; signs it is fast; proof it is real.
*Red flags:* "replaces your coach"; personal-trainer language (clients,
nutrition, payments); a feature dump with no priority; a heavy, slow page from
a product promising speed; numbers that cannot be true together.

**(b) The serious athlete.** On a phone, between sets, possibly with no signal.
*Looks for:* in one screen, what this is and that logging is fast; does it work
offline; one obvious button. *Red flags:* a modal over the first screen; a CTA
below the fold; carousels; a page that takes long enough to notice.

**(c) The AI Slop Specialist**, from
`RubbleOS/Personas/AI Slop Specialist.md` (read in full). Slop is an
effort/accountability mismatch, not "AI was used". Describe symptoms, never
accuse. *Looks for:* purple/indigo defaults and aurora gradients, glass cards,
icon-card grids and bento without a reason, stat banners, a badge pill over
the H1, three-tier pricing, tricolons and "not X, it's Y", superlatives with
nothing behind them, "generic specificity", and copy no human appears to have
re-read. *Positive signs:* one strong layout primitive repeated, one accent
that does all the work, real numbers instead of decoration, a stated reason for
every colour and font.

### (a) Coach findings

| | Finding |
| --- | --- |
| TrueCoach | The only page that talks to coaches, but to personal trainers: Nutrition, Payments and Custom Theming get the same weight as programming, and there is no RPE or percentage vocabulary anywhere. The Compliance Tracking tile is the one thing he would trust, because it says how the number is computed. The 16,000 vs 20,000 claim would make him doubt the rest. A 4.5 MB page from the people promising to save him time. |
| Hevy | Nothing for him. Coaching is a link to another site. What he would notice is the set-row mockup: that is the screen his athletes would have to like. |
| JuggernautAI | Speaks his sport better than either, then tells his athletes they do not need him ("the best coach in the world with you during every training session"). Copy errors (300 vs 250 exercises, a duplicated paragraph, © 2023) read as nobody minding the shop. |

### (b) Athlete findings

| | Finding |
| --- | --- |
| TrueCoach | On a phone the first screen is a cookie modal. The athlete is a "client" and appears once, near the bottom. A 14,000 px scroll on mobile. |
| Hevy | Best of the three. H1, description, store badges and rating in the first screen, no modal, light page. "Workout Offline" is listed. The H1 itself says nothing a competitor could not. |
| JuggernautAI | Cookie banner over 45% of the first screen; CTA below it. Features hidden in carousels. The sport vocabulary (RPE, plate maths, meet day) is right. |

### (c) AI Slop Specialist findings

| | Symptoms observed |
| --- | --- |
| TrueCoach | Purple gradient and stock smiling-trainer photo; a stat banner that rendered "0K+"; nine icon tiles each ending "Learn More"; headings written for search engines. Mostly pre-AI SaaS convention rather than generation: the failure is imitation without a reason, which is what the lens flags. |
| Hevy | Lowest. Real product UI instead of decoration. Unverifiable superlatives ("#1", "17+ million") are the one symptom. |
| JuggernautAI | A paragraph duplicated word for word under a different heading, and figures that contradict each other: consistent with copy no one re-read, whoever wrote it. "Cutting-edge technology", "smartest", "$2400+ value" are superlatives with nothing behind them. |

### Combined verdict

**Where all three lenses agree**
1. Show the mechanics, not the superlatives. TrueCoach's compliance formula and
   Hevy's set row are the two most persuasive things across all three pages,
   and both are the product explaining itself.
2. No headcount or rating claims. Every number of that kind on these pages is
   either unverifiable or contradicted on the same page, and SNB has none to
   make anyway.
3. Keep the phone's first screen clear. Two of three pages lose their mobile
   CTA under a cookie modal. SNB sets no tracking cookies [Inference: the app
   has no analytics or third-party scripts in `app/layout.tsx`], so it needs
   no banner at all.

**Where they disagree, left as disagreements**
1. **Proof.** The coach lens wants to see that a real coach uses it before
   trusting it with athletes. The slop lens says any proof at this stage is a
   risk: a quote without consent, or a number that is not true yet. *Resolved
   for now* by stating the beta plainly ("one powerlifting coach and their
   athletes") with no name or quote. **Open for Joey:** ask Ruairi whether he
   will give a named line once the beta has run.
2. **Who the page is for.** The athlete lens wants Hevy's single-purpose page;
   the coach lens wants TrueCoach's coach-first one. The customer is the coach
   (CLAUDE.md), so the promise is written to the coach, and the athlete gets an
   equal half of the feature section rather than a footnote.
3. **The animated hero.** The athlete lens counts it as cost on a phone; the
   slop lens is wary of anything decorative; the coach lens is neutral. *Resolved*
   by making it cheap (no dependency, loaded after the page, still poster by
   default), putting it after the copy and CTA on mobile, and making it carry
   the brand's meaning rather than decorate. If it cannot carry its weight,
   the poster on its own is a complete hero.

---

## 3. The SNB page

### The promise

> **Write the block. See every set.**
>
> You write the training on a laptop. Your athletes log it on their phones,
> mid-session, signal or not. Their sets, videos and bodyweight come back to
> you, without a message thread.

Written to the coach. Every clause is something the app does today (section 4).

### The call to action

[Fact] How getting in actually works, from the code:
- `/sign-in` offers **Sign in** and **Create account** on one screen
  (`app/sign-in/sign-in-form.tsx`), with email and password, Google, and Apple
  when `NEXT_PUBLIC_APPWRITE_APPLE_ENABLED` is set. **Sign-up is open:** nothing
  stops a stranger creating an account.
- A new account is asked coach or athlete on `/welcome` (docs/onboarding.md).
  Choosing Coach gives an invite code; an athlete links by entering it
  (docs/invite-codes.md, docs/coach-links.md).
- There is no "request access" or waitlist mechanism anywhere in the repo.

So the primary CTA is **"Sign in or create an account" → `/sign-in`**, the
existing route, unchanged. Under it: "In private beta. Athletes join with their
coach's invite code." A "Request beta access" button would need a form and
somewhere to store requests, which is a schema change this branch is not
allowed to make, and would promise a process that does not exist. **Open for
Joey:** whether to add one, and whether open sign-up is what he wants while the
page is public.

### Section by section

| # | Section | What it does | Copied from | Fixes | Left out, and why |
| --- | --- | --- | --- | --- | --- |
| 1 | Header | Mark, name, Sign in | | | Nav menu: four sections do not need one |
| 2 | Hero | Promise, one CTA, beta line, the stick-and-boulder hero | Hevy: one sentence, one button, nothing over the first screen | TrueCoach and Juggernaut's modals over the mobile CTA | Stat line, rating, logo strip: none are true yet |
| 3 | One account, two screens | Coach column, athlete column, each point saying how it works | TrueCoach's compliance formula: say how the number is made. Hevy's concrete checklist items | TrueCoach's nine equal tiles; Hevy's athlete-only page | Icons on each point; screenshots (see open decisions) |
| 4 | How athletes join | The three real steps, with a real-format code `SNB-4F7K2` | | Every page studied leaves onboarding vague | |
| 5 | What it does not do | No AI coach; no leaderboards or feed | | Juggernaut's "best coach in the world" | Nutrition and the other out-of-scope items: one line each would be a list of absences |
| 6 | Where it is now | Private beta, plainly; the CTA again | | Juggernaut's © 2023 and contradicting counts | Dates. The Dec 2026 handover and Jan 2027 coaches are internal targets, not public promises |
| 7 | Footer | © 2026, Sign in | | | Privacy and terms links: no such pages exist yet (open decision) |

Pricing is left out entirely: there is none (billing is phase 5).

---

## 4. What is real today

Each line on the page, against where it comes from. If a feature changes, change
the page and this table together.

| Page says | Source |
| --- | --- |
| Type `142.5`, `75%`, `@8`, `75% @8`; anything unrecognised is kept as typed | docs/prescriptions.md, "Five kinds, one typed cell" and "Parsing never fails" |
| Kilos show next to the percentage | docs/program-layout.md |
| Roster opens on videos, unprompted RPE 10, missed sessions, no weigh-in for 7 days | docs/roster.md "The triggers", all four "live now: yes" |
| Every clip in one queue, next to its set, with what was prescribed; comment stays on the set | docs/review-queue.md, docs/comments.md |
| Athletes log bodyweight; the trend is on their page | docs/bodyweight.md |
| Export a log as CSV, athlete or coach | docs/csv-export.md |
| Today is the coach's session, percentages turned into kilos | docs/programs.md (Order 22), docs/prescriptions.md "She sees" |
| Logging works with no signal; saves to the phone first | docs/offline.md, docs/pwa.md |
| Upload carries on after the wifi drops | docs/video-upload.md (resume across a drop and reload, proved by `e2e:video`) |
| Estimated max on every set; records marked at the finish | docs/e1rm.md; F22 finish screen |
| Type an exercise or add your own | `components/exercises` typeahead; CLAUDE.md constraint 3 |
| Next-set load suggested from RPE, if the coach switches it on | docs/suggestions.md; `components/coach/suggestion-switch.tsx` |
| Installs from the browser, no app store | docs/pwa.md |
| One account does both; switch from the header | docs/onboarding.md; CLAUDE.md "mode switcher in the header" |
| Invite code like `SNB-4F7K2`; athlete sees the coach's name and confirms | docs/invite-codes.md, docs/coach-links.md |
| No AI coach | CLAUDE.md constraint 8 |
| No leaderboards or feed | CLAUDE.md "Explicitly out of scope" |

Not claimed, because it is not true or not checked: any speed figure for the
app, any user count, Apple sign-in (hidden behind a flag), next comp or attempt
planning, nutrition.

---

## 5. The hero

Joey's direction: the stick-and-boulder logo, animated, about growth. You only
ever see the end result of powerlifting; the years of unglamorous work that
built it are invisible. Sticks are the thin, breakable start; boulders are
dense, heavy and earned.

### Three concepts

**A. The pile (first build, replaced).** The logo in 3D: a thick copper stick
leaning on a grey boulder. The scene runs back to a single twig, then sticks
land beside it one at a time, the heap packs into stone, and the twig, now
thick, leans on it. On brand, but Joey's review (28 Oct): keep the style, make
it more animated and make it about powerlifting. Nothing in it said "lifting".

**B. The strata.** A cut-away boulder, rotating slowly, whose layers are made
of compressed sticks; scrolling the page adds a layer per section. It says
the same thing, but scroll-linked animation ties the hero's cost to the whole
page's scroll, and it never resolves into the logo.

**C. The bar (built, merged with A).** The first version of this concept was
rejected for losing the stick-and-boulder identity. It does not have to: the
stick is the bar and the boulders are the plates. The page opens on a loaded
barbell locked out over a low-poly competition platform (rubber where the
plates land, wood in the middle where a lifter stands). It runs back to one
thin twig lying on the platform. Sticks gather round both ends of it, slowly
at first and then faster, and the heaps lift the bar off the floor as they
grow. Each heap packs into a faceted stone plate. Then the bar comes off the
floor: it bends as the plates break from the platform, the way a loaded bar
does on a heavy deadlift, and locks out. Two more reps make it a triple, and
it stops where it started. The counter runs "Week 1" to "Week 156", then
"Rep 1" to "Rep 3". The camera swings slowly round the bar and back over the
whole ~18 seconds.

**Why C now.** It keeps everything that made A right (the logo's materials
and lighting, growth through time, a still last frame) and adds the sport. No
lifter is shown, on purpose: you only see the bar move, which is the point
about only seeing the result. Plates and bar whip are the most recognisable
thing in powerlifting that is not a person.

### How it is built

**Software 3D on a 2D canvas, no dependency.** `lib/landing/hero-geometry.ts`
builds the scene once from a seeded random generator (a 6-sided bar with
thicker sleeves, 52 four-sided sticks, two 80-face stone plates, a three-strip
platform), lights each face from the upper left like the logo with a weak fill
from the camera's side, culls back faces, and depth-sorts, returning flat
polygons. The bar is cut into five pieces where it passes through the plates so
the depth sort can hide the part inside each plate. About 150 faces at rest
and a few hundred mid-build. The bend is a parabola along the bar, largest as
the plates leave the floor (`bendAt`).

**What happens when** is `momentAt(ms)` in `lib/landing/hero-mode.ts`, pure
and tested: hold the poster 0.9 s, rewind 1.7 s, build 7.2 s (the last fifth
of it is the first pull), then two reps of lower 1.1 s, floor 0.7 s, pull
1.4 s, hold 0.8 s. About 18 s in all.

| Option | Cost on the wire | Why not / why |
| --- | --- | --- |
| three.js | ~150 KB gzip for the core [Inference: typical tree-shaken three r16x builds], more than the rest of the page's JavaScript | Built for textures, depth buffers and thousands of faces; this has none |
| react-three-fiber | three.js plus ~40 KB [Inference] | Same, plus a second React reconciler |
| Raw WebGL | Small | Needs a GPU path and a separate no-WebGL fallback |
| **Canvas 2D, hand-rolled** | **3.5 KB gzip [Fact, build output, barbell version]** | Flat-shaded low poly needs exactly a depth sort and a fill. Runs on every browser, GPU or not |

`docs/athlete-motion.md`'s no-animation-library rule is for the athlete's
screens; this page adds no library either, so the question did not arise.

**One geometry, two renderers.** The server renders `heroFrame(1)` as an SVG
poster (`components/landing/hero-poster.tsx`), so the geometry never ships to
the browser for it. The canvas loop (`components/landing/hero-canvas.ts`) is a
separate chunk loaded with `import()` only when the hero scrolls into view and
is allowed to move. The canvas's first frame is the poster, in the same 4:3
box, so the swap moves nothing.

**When it stays still** (`lib/landing/hero-mode.ts`, tested):
- `prefers-reduced-motion: reduce`. A Play button is still offered, so it is a
  choice rather than a loss.
- Save-Data on.
- No 2D canvas.
- Two CPU cores or fewer.
- Measured too slow: if the median of the first 20 frames is over 34 ms (under
  ~30 fps), it jumps to the last frame and stops.
- No JavaScript: the poster is plain server HTML.

**Cost while running:** device pixel ratio capped at 2; pauses when the tab is
hidden or the hero is scrolled away; stops requesting frames entirely once the
triple ends; a Stop button while it plays (WCAG 2.2.2, anything moving for over five
seconds can be stopped).

### Measured, 28 Oct 2026

- **Hero chunk:** 7.3 KB raw, **3.5 KB gzipped** for the barbell version
  (the first, stick-and-boulder version was 3.0 KB) [Fact, `.next/static/chunks`
  after `next build`]. Loaded after hydration, not in the page's first script.
- **Barbell version, Lighthouse mobile, three runs:** performance 95 / 92 / 92,
  LCP 3.0 / 3.3 / 3.3 s, TBT 10 / 0 / 0 ms, CLS 0. No cost over the first version.
- **`/` is prerendered static** [Fact, build output `○ /`].
- **Layout shift: 0.** Lighthouse CLS 0 on every run, and the H1 sits at the
  same pixel with JavaScript on and off (checked with Playwright at 1440×900).
- **Lighthouse 12, mobile, simulated slow 4G, `next start`, three runs:**
  performance 78 / 93 / 94; FCP 0.9 s; LCP 4.0 / 3.2 / 3.1 s; TBT 390 / 0 / 10 ms;
  CLS 0; ~420 KB transferred. Accessibility 94, best practices 96, SEO 100.
  The first run was cold.
- **LCP is the app's, not this page's.** The LCP element is the hero paragraph
  and 85% of it is render delay. `/sign-in` on the same server scores LCP 3.5 /
  3.2 s, so this comes from the shared shell (fonts, hydration) [Inference: same
  numbers on a page this branch did not change]. Worth its own ticket against
  the 2.5 s target in CLAUDE.md.
- **Accessibility 94** loses points only to `meta-viewport`
  (`userScalable: false` in `app/layout.tsx`), an existing app-wide choice.
- **Not measured:** a real phone, a real GPU. Headless Chromium drew the canvas
  (it needs no GPU), but how smooth it feels on a mid-range Android is
  [Unverified] until someone opens it on one.

---

## 6. Signed in, signed out

[Fact] Before this branch, `/` rendered an empty dark `div` and redirected
everyone: `landingFor` in lib/auth/mode.ts sent signed-out visitors to
`/sign-in`. Session state is only known in the browser (Appwrite, client SDK),
so the server cannot choose between the two.

Now:
- The page is static and renders for everyone.
- `app/landing.tsx` still makes the decision, through `rootDecision` in
  `lib/landing/root.ts`: **signed in, exactly the old `landingFor` table**
  (Today, roster, `/welcome`, the migration row, the offline row); **signed
  out, stay**. `landingFor` itself is unchanged, and so is its test.
- An inline script, run as the HTML parses (the pattern in Next's own
  "preventing flash before hydration" guide), sets `data-returning` on `<html>`
  if the device has the remembered-user record, and CSS hides the page under
  it. A returning athlete opening the installed app sees the same blank dark
  frame as before, never the marketing page. If that record is stale, the gate
  removes the attribute once Appwrite answers signed out.
- After signing in, `/sign-in` sends people to `/` as before; the gate sets the
  attribute in a layout effect, before paint, so that hop does not flash the page.
- `/sign-in`, `/welcome`, invite redemption and the offline rows are untouched.

---

## 7. The Slop Specialist on our own page

Run over the finished page, desktop and mobile screenshots.

| Flagged | What changed |
| --- | --- |
| "What it does not do" had three items, the third repeating the CSV point from the coach column: a padded tricolon | Cut to two |
| A neutral left rule on every feature point read as the "accent stripe on cards" tell | Removed |
| Mono all-caps labels over headings | **Kept, with a reason:** IBM Plex Mono labels are the app's own type system (globals.css, "Archivo carries content, IBM Plex Mono carries labels only"). The page should look like the product |
| Permanent dark theme | **Kept, with a reason:** globals.css, "Dark only… gyms are badly lit" |
| Numbered 1-2-3 steps | **Kept:** it is the literal procedure, with the real code format, not a decorative "how it works" |
| Accent colour | Copper from the logo's stick, the app's `--accent-fill`. No purple, no gradient, no glass, no icon grid, no stat banner, no badge pill |
| "Type, never scroll" | Kept: it is CLAUDE.md constraint 3 ("Type, never hunt") in the athlete's words |

---

## 8. Open decisions for Joey

1. **Open sign-up.** Anyone can create an account today. Fine for a page
   nobody links to; worth deciding before the page is shared.
2. **Request access.** None exists. If coaches outside Ruairi's circle should
   be able to ask, it needs a form and storage (a schema change), or a plain
   email address on the page.
3. **A named line from Ruairi.** Only with his agreement. Until then the page
   says "one powerlifting coach and their athletes".
4. **Product screenshots.** Hevy's strongest asset is its real set row. A real
   Log Session or Review Queue screenshot (with fake data) would beat any
   description; it needs Joey to choose the screens.
5. **Privacy and terms.** No pages exist; GDPR is phase 5. Worth having before
   the page is public.
