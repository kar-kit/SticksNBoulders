/**
 * Order 28: does an athlete see next-set load suggestions, or does the coach
 * hold them back?
 *
 * The Build Plan calls this "a coaching philosophy question, not ours", so the
 * coach decides, per athlete. Pure: no client, no storage, no clock.
 *
 * ## What "held" means here
 *
 * [Inference] The Profile blueprint's wording is "Athletes see them directly"
 * vs "Hold for my approval". Nothing in the feature list or any blueprint
 * specifies an approval queue -- who approves what, when, on which screen --
 * and an athlete resting two minutes between sets cannot wait on one anyway.
 * So the smallest reading that keeps the coach in control is taken: **held
 * means the athlete is shown no engine suggestion at all**, and the logger
 * falls through to prefill rule 3 (repeat the previous set), exactly as it did
 * before Order 27 existed. An approval workflow, if Ruairi wants one, is a
 * separate ticket and can reuse this switch as its "on".
 *
 * [Inference] Per linked athlete rather than one switch per coach. The
 * blueprint lists the toggle on both Profile & Settings and Athlete View; per
 * athlete is the shape that serves both (a coach may trust a veteran's RPE and
 * not a novice's -- the same scepticism the Athlete View's RPE curve exists
 * for), and it lives on the link row, which is already the record of this
 * relationship and is already readable by exactly the two people involved.
 *
 * This is not an AI coach: the switch exists so the coach stays in control of
 * whether arithmetic on the athlete's own RPE reaches them at all.
 */

export type SuggestionMode = "direct" | "held";

export const SUGGESTION_MODES: readonly SuggestionMode[] = ["direct", "held"];

/**
 * What a link with no stored choice means.
 *
 * Direct, as instructed for this ticket, and the Build Plan flags it
 * [SME to confirm] -- the blueprint says to ask Ruairi rather than ship a
 * default. Changing it is this constant and nothing else: rows written before
 * Order 28 carry no value and are read through `parseSuggestionMode`.
 */
export const DEFAULT_SUGGESTION_MODE: SuggestionMode = "direct";

/**
 * What the athlete's logger assumes when it has never been told.
 *
 * Held, deliberately the opposite of the default. This is only reached on a
 * device that has never once read its link row -- a fresh install opened with
 * no signal. Showing a suggestion the coach has switched off is the exact
 * failure this toggle exists to prevent; withholding one costs the athlete a
 * number typed, and the first read with signal corrects it.
 */
export const UNKNOWN_SUGGESTION_MODE: SuggestionMode = "held";

export function isSuggestionMode(value: unknown): value is SuggestionMode {
  return value === "direct" || value === "held";
}

/** A stored value, or the default for rows that pre-date the column. */
export function parseSuggestionMode(value: unknown): SuggestionMode {
  return isSuggestionMode(value) ? value : DEFAULT_SUGGESTION_MODE;
}

/**
 * The mode an athlete's logger runs under, from their active link rows.
 *
 * No active coach: direct. There is nobody to hold anything for, and an
 * athlete training solo is the person Order 27 was first built for.
 *
 * More than one (the schema allows it, the product refuses it -- see
 * docs/coach-links.md): held if any coach holds. One coach's "no" is not
 * overruled by another's silence.
 */
export function modeForAthlete(activeLinks: readonly { suggestionsMode: unknown }[]): SuggestionMode {
  if (activeLinks.length === 0) return "direct";
  return activeLinks.some((link) => parseSuggestionMode(link.suggestionsMode) === "held") ? "held" : "direct";
}

/** The coach's two choices, in the blueprint's words. */
export const SUGGESTION_MODE_LABEL: Record<SuggestionMode, string> = {
  direct: "Athlete sees them directly",
  held: "Hold them back",
};
