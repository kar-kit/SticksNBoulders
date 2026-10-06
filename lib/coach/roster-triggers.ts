/**
 * The Roster's "needs you" triggers, and nothing else.
 *
 * Order 24. Blueprint 10 asks for an exception list that is computed, never a
 * manual to-do list -- and the blueprint is BLOCKED on question 2 for Ruairi
 * (what does his review day actually look like, in order). Every trigger below
 * is inferred from his complaints on the 13 Sep call, not from watching him
 * work. So they live in this one file, as data plus one small function each,
 * so that his answer is an edit here and a test run rather than a refactor.
 *
 * Each rule is labelled [Inference] with the reasoning it rests on. The
 * thresholds are in TRIGGER_RULES, one place, named.
 *
 * Pure: no Appwrite, no React, no clock of its own. The screen hands it what
 * it read and the time.
 *
 * Two triggers from the blueprint depend on the program (Order 19, being built
 * in parallel) and fire only when a ProgramSignals is supplied. Nothing reads
 * program tables yet -- see `fetchProgramSignals` in roster-store.ts, which is
 * the seam. A third, bodyweight drifting against a weight class near a meet, is
 * not here at all: there is no meet or weight-class data in the MVP (comp
 * planning is February 2027), and CLAUDE.md forbids scaffolding for it.
 */

import { daysBetween, dayKey } from "@/lib/bodyweight/bodyweight";

/**
 * What the program will be able to say about an athlete once Order 19 lands.
 *
 * The seam. Shaped by what the two program-dependent triggers need and no more
 * -- Order 19 owns how it is computed, and a field added here without a rule
 * using it would be a guess at that design.
 */
export interface ProgramSignals {
  /** "Week 3 of 8", or however Order 19 names a position in a block. */
  blockLabel: string | null;
  /** Prescribed days in the current week whose date has passed with nothing logged. */
  missedSessions: number;
  /**
   * Working sets logged at RPE 10 where the prescription capped lower (or set
   * a fixed load with an RPE target below 10).
   */
  unpromptedMaxes: readonly { setId: string; loggedAt: string; prescribedRpe: number | null }[];
}

/** Everything one athlete's triggers are decided from. */
export interface AthleteSignals {
  athleteId: string;
  name: string;
  /**
   * The coach can actually read this athlete's circle. When false every read
   * comes back empty, and an empty read must not turn into "no bodyweight in a
   * week" about somebody who weighed in this morning. No triggers fire.
   */
  visible: boolean;
  /** When the link was made, for the new-athlete grace period. */
  linkedAt: Date | null;
  /** Clips this coach has not cleared. Per coach, as in the Review Queue. */
  unreviewedClips: number;
  /** YYYY-MM-DD of their newest weigh-in, or null if they have never logged one. */
  lastBodyweightOn: string | null;
  /** Order 19 seam. Null until the program exists; program triggers stay quiet. */
  program: ProgramSignals | null;
}

/**
 * The thresholds. Every one is [Inference] -- see the rule that uses it.
 * Changing a number here is the whole change; the tests are written against
 * these names, not the literals.
 */
export const TRIGGER_RULES = {
  /** No weigh-in for longer than this many days. Blueprint: "in over a week". */
  bodyweightGapDays: 7,
  /**
   * A just-linked athlete who has never weighed in is not yet a gap. They get
   * this long before the bodyweight trigger can fire.
   */
  newAthleteGraceDays: 7,
  /** How long an unprompted RPE 10 stays on the list after it was logged. */
  unpromptedMaxWindowDays: 7,
  /** Missed prescribed sessions this week before it is worth a line. */
  missedSessionsMin: 1,
  /** Unreviewed clips before it is worth a line. */
  videosMin: 1,
} as const;

export type TriggerRules = { [K in keyof typeof TRIGGER_RULES]: number };

export type NeedsYouKind = "unprompted-max" | "missed-sessions" | "videos" | "no-bodyweight";

export interface NeedsYouItem {
  athleteId: string;
  athleteName: string;
  kind: NeedsYouKind;
  /** The line as the coach reads it, without the name. */
  text: string;
  /** Where acting on it happens. */
  href: string;
}

/**
 * The order kinds are listed in, most urgent first.
 *
 * [Inference] An unprompted max goes first because it is the one Ruairi named
 * as throwing off his whole rhythm before a comp, and the blueprint says
 * surfacing it the day it happens is the improvement. Missed sessions next,
 * because they change what he writes for next week. Videos are routine work
 * with their own queue and badge. A missing weigh-in is the least urgent.
 */
export const KIND_ORDER: readonly NeedsYouKind[] = ["unprompted-max", "missed-sessions", "videos", "no-bodyweight"];

const DAY_MS = 86_400_000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const athleteHref = (athleteId: string) => `/coach/athletes/${athleteId}`;

type Rule = (athlete: AthleteSignals, now: Date, rules: TriggerRules) => Omit<NeedsYouItem, "athleteId" | "athleteName"> | null;

/**
 * [Inference] An RPE 10 where the prescription asked for less, logged in the
 * last week. Ruairi's specific complaint: an athlete maxing out unprompted
 * before a comp. A week, so a coach who checks in weekly still sees it; the
 * blueprint's "the day it happens" is satisfied because it appears at once.
 * Program-dependent: silent until Order 19 supplies `program`.
 */
const unpromptedMax: Rule = (athlete, now, rules) => {
  const cutoff = now.getTime() - rules.unpromptedMaxWindowDays * DAY_MS;
  const recent = (athlete.program?.unpromptedMaxes ?? []).filter((set) => {
    const at = new Date(set.loggedAt).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
  if (recent.length === 0) return null;
  return {
    kind: "unprompted-max",
    text: `logged ${plural(recent.length, "set", "sets")} at RPE 10 that ${recent.length === 1 ? "wasn't" : "weren't"} prescribed that hard`,
    href: athleteHref(athlete.athleteId),
  };
};

/**
 * [Inference] Prescribed sessions this week whose day has passed with nothing
 * logged. "Missed sessions against the block" in the blueprint; one is enough,
 * because a powerlifting week has three to five sessions and one missed is
 * already a fifth of it. Program-dependent: silent until Order 19.
 */
const missedSessions: Rule = (athlete, _now, rules) => {
  const missed = athlete.program?.missedSessions ?? 0;
  if (missed < rules.missedSessionsMin) return null;
  return {
    kind: "missed-sessions",
    text: `missed ${plural(missed, "session", "sessions")} this week`,
    href: athleteHref(athlete.athleteId),
  };
};

/**
 * [Inference] Any unreviewed clip. The blueprint lists unreviewed videos; that
 * one clip is enough, and that its age does not matter, are assumptions. It
 * links to the Review Queue rather than the athlete, because clearing happens
 * there.
 */
const videos: Rule = (athlete, _now, rules) => {
  if (athlete.unreviewedClips < rules.videosMin) return null;
  return {
    kind: "videos",
    text: `${plural(athlete.unreviewedClips, "video", "videos")} waiting`,
    href: "/coach/review",
  };
};

/**
 * [Inference] No weigh-in for over a week, from the blueprint. Two assumptions
 * of ours on top: an athlete who has never logged one is included once they
 * have been linked for the grace period (otherwise the trigger never fires for
 * the athlete who most needs the nudge), and "a week" is counted in whole days
 * on the coach's calendar.
 */
const noBodyweight: Rule = (athlete, now, rules) => {
  if (athlete.lastBodyweightOn) {
    const gap = daysBetween(athlete.lastBodyweightOn, dayKey(now));
    if (gap === null || gap <= rules.bodyweightGapDays) return null;
    return { kind: "no-bodyweight", text: `no bodyweight in ${gap} days`, href: athleteHref(athlete.athleteId) };
  }
  // Never logged. Without a link date there is no grace period to measure, so
  // stay quiet rather than nag about somebody who may have joined an hour ago.
  if (!athlete.linkedAt) return null;
  const linkedDays = Math.floor((now.getTime() - athlete.linkedAt.getTime()) / DAY_MS);
  if (linkedDays <= rules.newAthleteGraceDays) return null;
  return { kind: "no-bodyweight", text: "no bodyweight logged yet", href: athleteHref(athlete.athleteId) };
};

const RULES: Record<NeedsYouKind, Rule> = {
  "unprompted-max": unpromptedMax,
  "missed-sessions": missedSessions,
  videos,
  "no-bodyweight": noBodyweight,
};

/**
 * The "needs you" list across every athlete: grouped by kind in KIND_ORDER,
 * then by name. Empty is the good outcome ("Nothing needs you today").
 */
export function needsYou(
  athletes: readonly AthleteSignals[],
  now: Date,
  rules: TriggerRules = TRIGGER_RULES,
): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  for (const athlete of athletes) {
    if (!athlete.visible) continue;
    for (const kind of KIND_ORDER) {
      const hit = RULES[kind](athlete, now, rules);
      if (hit) items.push({ athleteId: athlete.athleteId, athleteName: athlete.name, ...hit });
    }
  }
  return items.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.athleteName.localeCompare(b.athleteName),
  );
}
