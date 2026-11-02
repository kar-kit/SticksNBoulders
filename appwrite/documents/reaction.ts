/**
 * The six reactions, and nothing else (F25, schema v23).
 *
 * Joey fixed the set and its order on 2 Nov 2026, after a real session: a
 * thumbs up, a flex, fire, a heart, a laugh and a question. Fixed rather than
 * a full emoji keyboard because a reaction here is a quick acknowledgement
 * between a coach and the person they coach -- "seen", "nice", "huh?" -- and
 * six is what fits under a thumb on one row of a phone.
 *
 * Its own file, with no imports, for the reason poster.ts and avatar.ts are:
 * the validate-row Function bundles provenance.ts, provenance.ts needs this
 * list to judge a reaction, and anything this file pulled in would ride into
 * the Function's deployment with it. The Zod schema for the write boundary is
 * in write.ts, which the Function does not bundle.
 *
 * Stored as the emoji itself, exactly these code points. ❤️ is two -- the
 * heart and the emoji-presentation selector (U+FE0F) -- and a bare ❤ is a
 * different string, so it is refused like any other stranger. Nothing here
 * normalises: a write path that sends the bare heart has a bug worth seeing,
 * and a reader that quietly folded the two together would hide it.
 */
export const REACTION_EMOJIS = ["👍", "💪", "🔥", "❤️", "😂", "❓"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/**
 * Matches `comment_reactions.emoji` in the schema. Room for the longest of the
 * six (❤️, two code points) with headroom, and not for a sentence: a column
 * sized for one emoji is a column nobody can smuggle a message into.
 */
export const REACTION_EMOJI_MAX = 8;

/** Whether a stored or submitted value is one of the six, exactly. */
export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && (REACTION_EMOJIS as readonly string[]).includes(value);
}

/**
 * What each one is called, for a screen reader and a long-press tooltip. A
 * bare "🔥" read aloud is "fire", which is fine; "❓" is "black question mark
 * ornament" in some voices, which is not.
 */
export const REACTION_NAMES: Readonly<Record<ReactionEmoji, string>> = {
  "👍": "thumbs up",
  "💪": "strong",
  "🔥": "fire",
  "❤️": "heart",
  "😂": "laughing",
  "❓": "question",
};
