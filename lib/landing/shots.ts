/**
 * The app screenshots on the landing page.
 *
 * Real screens of this app, rendered by the dev server with every Appwrite and
 * /api request answered by made-up fixtures in the browser, so no live data
 * and no live instance were involved. The names on them are invented. The
 * page captions each one "Demo data". docs/landing-page.md has how they were
 * made and how to remake them when the screens change.
 *
 * Width and height are the file's pixels; next/image uses them to reserve the
 * space, so nothing shifts when they load.
 */

export interface Shot {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
  /** A phone screen: shown narrower, in its own cell. */
  phone: boolean;
}

export const SHOTS = {
  roster: {
    src: "/landing/roster.webp",
    alt: "The coach's roster. Needs you: two athletes with videos waiting, one RPE 10 that wasn't prescribed, a missed session, no bodyweight in 11 days. Then one row per athlete with sessions and sets this week, videos, bodyweight and block week.",
    caption: "Roster",
    width: 1800,
    height: 1125,
    phone: false,
  },
  program: {
    src: "/landing/program.webp",
    alt: "The program editor on Week 2 of a strength block. Load cells typed as @8, 77.5% @8 (worked out to 102.5 kg), 145, and a freeform line, each with what the app read it as underneath.",
    caption: "Program editor",
    width: 1800,
    height: 1125,
    phone: false,
  },
  today: {
    src: "/landing/today.webp",
    alt: "Today on a phone: Thursday's squat session as the coach wrote it, with loads in kilos, a coach's note, and a button to start the session.",
    caption: "Today",
    width: 780,
    height: 1688,
    phone: true,
  },
  log: {
    src: "/landing/log.webp",
    alt: "Logging squats on a phone: four sets with kilos, reps and RPE, one marked as a rep PR and one queued with no signal, then the first bench set ready with the rest timer running.",
    caption: "Log session",
    width: 780,
    height: 1688,
    phone: true,
  },
} satisfies Record<string, Shot>;
