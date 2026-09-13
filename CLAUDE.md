@AGENTS.md

# SticksNBoulders

Coaching software for powerlifting. The customer is the **coach**. The athlete is the user who has to enjoy it enough not to drift back to Strong.

The pitch: the programming power of RTS, in an app athletes will actually open, with the video review and the numbers coaches currently chase by hand.

---

## ⚠️ Read this before touching any code

**As of 13 September 2026 this project is being rebuilt.** Everything currently in this repo is the previous version, written against a different product: a private competitive gym-tracking PWA for a three-person friend group, with DOTS leaderboards as the core loop and a scale-photo anti-cheat check.

**That product no longer exists.** After a discovery call with Joey's coach, Ruairi, on 13 Sep 2026, it became a coaching platform sold to coaches.

So:

- **Do not treat the existing code as a source of truth for anything.** Not the data model, not the routes, not the components, not the naming.
- **Do not try to migrate or refactor it forward.** It solves a different problem.
- Reuse is fine where something happens to be genuinely useful (a utility, a config, the PWA manifest, asset files), but read it with suspicion and never assume it matches the current spec.
- **The spec lives in Notion**, not in this repo. Links below.

When in doubt about whether something in the repo is current: assume it is not.

---

## Where the spec lives

All in Notion, under the **Sticks N Boulders** page.

| Doc                            | What it is                                 | Link                                                      |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------- |
| Sticks N Boulders              | Project home                               | https://app.notion.com/p/3da64699b43c80bc8323e669ed545fc1 |
| MVP Feature List — Ruairi Beta | 41 features, build order, priority, source | https://app.notion.com/p/c1595d12346b47fd9939ea81cd33ab4d |
| Page Blueprints                | 13 page specs with wireframes and states   | https://app.notion.com/p/3da64699b43c80e4ba32ff4253407b74 |

### Page blueprints, individually

**Read `00 — Conventions` first.** Everything else assumes it.

| Page                            | Platform        | Link                                                      |
| ------------------------------- | --------------- | --------------------------------------------------------- |
| 00 — Conventions & Shared Shell | both            | https://app.notion.com/p/3da64699b43c81d69934c00b29170a05 |
| 01 — Sign In                    | both            | https://app.notion.com/p/3da64699b43c8130b89be369d1c79c6b |
| ↳ Onboarding & Invite Code      | mobile          | https://app.notion.com/p/3da64699b43c81e68af2f0e4ebd76e60 |
| 02 — Today                      | athlete, mobile | https://app.notion.com/p/3da64699b43c81a9a72bffa5dd585950 |
| 03 — Log Session                | athlete, mobile | https://app.notion.com/p/3da64699b43c818d82e0dbff5837f67c |
| ↳ Set Row component             | athlete, mobile | https://app.notion.com/p/3da64699b43c810ca227ec8dbc4e2dc1 |
| 04 — History                    | athlete, mobile | https://app.notion.com/p/3da64699b43c81209bc4e845f96a90a3 |
| 05 — Lift Detail                | athlete, mobile | https://app.notion.com/p/3da64699b43c81ad8976cc3baf8eab36 |
| 06 — My Program                 | athlete, mobile | https://app.notion.com/p/3da64699b43c81ba82fdc5077fcb540e |
| 07 — Coach Feedback             | athlete, mobile | https://app.notion.com/p/3da64699b43c812c974ed2b7f079dadd |
| 08 — Bodyweight                 | athlete, mobile | https://app.notion.com/p/3da64699b43c8110abc5c164366ec272 |
| 09 — Profile & Settings         | both            | https://app.notion.com/p/3da64699b43c815bb36bc6fb13ba3dbf |
| 10 — Roster                     | coach, desktop  | https://app.notion.com/p/3da64699b43c811db43adb7a1b0f0a2e |
| 11 — Review Queue               | coach, desktop  | https://app.notion.com/p/3da64699b43c81c6a79be61bbbf54309 |
| 12 — Athlete View               | coach, desktop  | https://app.notion.com/p/3da64699b43c81d99ccfef13c3c64b5a |
| 13 — Program Editor             | coach, desktop  | https://app.notion.com/p/3da64699b43c8120af4dd7f98ab7738b |

There is also a fuller Build Plan and the raw coach discovery notes in Joey's local RubbleOS workspace, under `SticksNBoulders HQ/`. Ask for them if a Notion page is not detailed enough.

---

## Two products, one codebase

Not one responsive app with breakpoints. Two distinct surfaces:

|              | Athlete                          | Coach                         |
| ------------ | -------------------------------- | ----------------------------- |
| Device       | Phone, one-handed, mid-set       | Laptop or desktop             |
| Baseline     | 390 × 852pt (iPhone 15 Pro / 16) | 1440 × 900, must work at 1280 |
| Session      | 30 seconds at a time             | 30–60 minutes, weekly         |
| Input        | Thumb, sweaty                    | Keyboard first                |
| Optimise for | Speed of a single tap            | Speed of bulk work            |

The coach side degrading to read-only on a phone is acceptable. Ruairi is not writing a training block on his phone.

**A coach is usually also an athlete.** Same account, mode switcher in the header. Role is a relationship (do you have athletes linked to you), never an account type.

---

## Stack

Decided, not up for renegotiation without Joey saying so.

- **Frontend**: Next.js (App Router, TypeScript), Tailwind, TanStack Query, Zod on every boundary
- **Backend**: **Appwrite** — Auth, Databases, Storage, Functions, Realtime
- **Hosting**: Appwrite self-hosted through the private beta, migrating to **Appwrite Cloud** before the second coach gets access (January 2027)
- **Offline**: IndexedDB write-ahead queue with optimistic UI. **Not** a CRDT or a local-first framework — sets are append-mostly and edited by one person
- **PWA**: manifest + service worker, installs to home screen. No app store submission

Joey builds with **Claude Code**. Not Codex, not Base44.

### Appwrite: two rules that are not optional

Appwrite gives up two things Postgres would have provided free. Both are paid for up front, in phase 0.

**1. Access control is per-document, stamped at write time.**

There is no row-level security policy to audit — only every write path. One code path that forgets to stamp permissions is either data the coach cannot see, or data someone else can.

- **Every write goes through a single helper module.** Nothing calls `databases.createDocument` or `updateDocument` directly from a component, a route handler, or anywhere else. Ever.
- The helper owns permission logic per collection, reading `coach_athlete_links` as the source of truth for who can see what.
- That helper is hand-written and reviewed line by line, not generated and skimmed.
- A permission bug is sev-1. There is a permission audit script; run it before each phase ships.

**2. There is no GROUP BY.**

Nearly every screen is an aggregate. Appwrite will not compute them.

- `e1rm_kg` is **computed and stored on the set document at write time**, not derived on read.
- `stats_rollups` — one doc per athlete per lift per week (volume, tonnage, set count, best e1RM, best rep PR), written by a Function on set creation. **Every dashboard and chart reads rollups, never raw sets.**
- `personal_rpe_curves` — one doc per athlete per lift, recomputed on a schedule.
- Denormalise fields you filter or sort by (`athlete_id` on sets, at minimum). Write them in the same helper that stamps permissions so they cannot drift.
- **Ship a rebuild script** that regenerates every rollup and curve from raw sets. The e1RM maths and the RPE chart will change.

### Keeping the Cloud migration cheap

- **Schema as code.** Collections, attributes, indexes and permissions in a versioned setup script, applied with one command. Never click collections into existence in the console.
- **Endpoint in an env var**, from the first commit.
- Scheduled backups of the self-hosted instance, stored off that machine, from day one.

---

## Non-negotiable product constraints

1. **Speed is a feature.** Ruairi's first and loudest complaint about RTS was load time. Interactive under 2.5s on 4G. Logging a set is instant because it writes locally first. If a screen cannot hit that, redesign the screen.
2. **Sign in three ways, all first-class.** Email and password, Continue with Apple, Continue with Google. Magic link was considered and cut — Joey's call, 13 Sep. Ruairi's complaint was managing a login per athlete, and the single-account-plus-invite-code model solves that on its own, so the auth method was never the fix. What matters instead: long sessions, silent refresh, correct `autocomplete` attributes so password managers fill the fields, and never signing someone out mid-workout.
3. **Type, never hunt.** Every exercise / athlete / lift selector is free-text typeahead with fuzzy matching and create-on-the-fly. Never a filter tree or a 400-item dropdown. This is Ruairi's complaint #2, directly.
4. **Offline is normal, not an error.** A queued set looks like a logged set with a small pending mark. No spinners, no error toasts, no blocking.
5. **Logged work is immutable; prescriptions are not.** A coach editing a block mid-way never rewrites what an athlete already did.
6. **Freeform escape hatches stay.** The freeform prescription type and CSV export exist because the competition is Excel. Do not remove them for being "unclean" — every rigid screen is a reason to reopen the spreadsheet.
7. **Every screen needs a real empty state.** Ruairi's first session is an entirely empty account.
8. **This is not an AI coach.** The market is saturated with "replace your coach with AI" products and the buyer is the coach. Any AI removes admin from the coach; it never generates the coaching. This is an engineering constraint, not just marketing.

---

## Build order

From the Notion feature list. Dates work backwards from two commitments made to a real person.

| Phase | Scope                                                                                          | Target                            |
| ----- | ---------------------------------------------------------------------------------------------- | --------------------------------- |
| 0     | Appwrite, schema as code, write helper + permissions, email/password + OAuth auth, Next.js shell, backups  | late Sep 2026                     |
| 1     | Athlete logger: sessions, set logging, typeahead, offline, history, lift detail, e1RM, rollups | mid Oct 2026                      |
| 2a    | Coach link, invite codes, program editor, prescription model, reference maxes                  | mid Nov 2026                      |
| 2b    | RPE engine: chart, e1RM derivation, next-set suggestions                                       | end Nov 2026                      |
| 3     | Video on sets, chunked upload, coach review queue, comments                                    | early Dec 2026                    |
| 4     | Bodyweight + DOTS, roster dashboard, profile, permission audit, PWA polish                     | **mid Dec 2026 — hand to Ruairi** |
| 5     | Cloud migration, billing, self-serve onboarding, GDPR                                          | Jan 2027 — three more coaches     |

**Dogfood phase 1 in parallel with 2a.** Joey logs his own training in it from mid-October. If he will not use it over Strong, no athlete will.

**Do not hand it over while it breaks.** One bad first session with a busy coach costs more than a month of delay.

---

## Explicitly out of scope for the MVP

Do not build these, do not scaffold for them, do not add "just the data model for now":

- Leaderboards, groups, friend competition (final phase, long after the beta)
- Scale-photo anti-cheat and any vision model — **cut entirely**, not deferred
- Comp planning and the attempt board (Feb 2027)
- Nutrition and food logging (CSV export is the MVP answer)
- OpenPowerlifting integration
- Apple Watch, Siri, Health integrations, muscle heat maps, body measurements, social feed, workout sharing, supersets, AI-generated programming

---

## How to work on this

**Check the Source column before implementing a feature.** Every item in the Notion feature list is tagged `Ruairi`, `Joey` or `Inferred`. Fourteen of the 41 are `Inferred` — nobody asked for them, they are the previous planning session's additions. Treat those as proposals. If one is awkward to build, say so rather than grinding it out.

**Do not invent requirements.** If something is not in the feature list or a blueprint, it is not agreed. Propose it, label it as your inference, and let Joey decide.

**Label uncertainty.** `[Fact]` with a basis, `[Inference]` with reasoning, `[Unverified]` with what would confirm it, `[SME to confirm]` where Ruairi has to answer. This matters most for anything that becomes a number in someone's training program.

**Ask before assuming on the two blocked decisions.** Both are marked in the blueprints:

- **Program Editor shape** — does Ruairi write a full block up front, week by week, or session by session? The current design assumes block-up-front. It is the most expensive assumption in the plan.
- **Roster layout** — what does his review day actually look like, in order? The "needs you" triggers are inferred from his complaints, not from watching him work.

### Verify before hardcoding

- **The RPE → %1RM chart.** Values in the Build Plan are the widely circulated Tuchscherer/RTS figures and are **[Unverified]**. Check row 11 first (the curve has a suspicious kink). Wrong numbers here are wrong numbers in every athlete's program.
- ~~**Appwrite passkey support.**~~ Resolved: auth is email + password, Google and Apple. Google is configured; Apple needs an Apple Developer account and is hidden behind `NEXT_PUBLIC_APPWRITE_APPLE_ENABLED` until it exists. App Store Review Guideline 4.8 forces Sign in with Apple only for store-distributed apps, and this is a PWA, so Apple is offered rather than mandatory.
- **Appwrite chunked upload resume** — does it resume after a dropped connection or restart from zero? Gym wifi makes this matter.

### Design workflow

The Notion blueprints fix **layout, hierarchy and behaviour**. They are not visual design — no colour, type or spacing beyond the direction in `00 — Conventions` (dark by default, high-contrast numerals, warm neutral palette from the low-poly stick-and-boulder logo, nothing decorative on the athlete side).

Visual design comes through the Claude Design connector. When generating designs, work from the blueprint for that page and keep the wireframe's structure; if the design wants to change the structure, flag it against the blueprint rather than silently diverging.

---

## People

- **Joey** — building it. Athlete on the platform. Dyslexic, learns by breaking things, plans roughly then builds and reviews.
- **Ruairi** — Joey's coach, design partner, first beta user. Free permanently. Coaches at Uxbridge alongside another coach, Louis. Everything in the spec traces back to a call with him on 13 Sep 2026.
- **Nafis, Hassan, Hussein** — three more coaches in Ruairi's circle. January 2027. They are forming a coaching group together and want their own branded UI.
