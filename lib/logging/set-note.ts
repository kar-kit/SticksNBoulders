import { SET_NOTES_MAX } from "@/appwrite/documents/write";

/**
 * The athlete's note on a set (F11).
 *
 * Joey, after a block of logging: "No way to add notes to videos" and "No way
 * to comment on normal sets". The `sets.notes` column has been in the schema
 * since phase 0 and nothing wrote it. This is the athlete's own line about one
 * set -- "left hip pinched on the way up", "belt too loose" -- and nothing
 * else: the coach's thread on a filmed set is `set_comments`, a different
 * thing with a different author, and is not touched by any of this.
 *
 * The rules live here rather than in a component because three screens write
 * a note (the Log's edit sheet, History, and the queue's replay of either),
 * and they have to agree on what a blank one means.
 */

/** The `sets.notes` column's size, from the write helper that caps to it. */
export const SET_NOTE_MAX = SET_NOTES_MAX;

/**
 * Characters left at which the counter appears.
 *
 * Not from the first keystroke: almost every note is a few words, and a
 * "487 left" ticking under "felt slow" is noise. Near the limit it is the
 * only warning before the textarea stops taking keys, so it shows from here.
 */
export const SET_NOTE_COUNTER_FROM = 100;

/**
 * What a typed note is stored as: trimmed, capped to the column, and null
 * when there is nothing left. Null is how a note is cleared -- an athlete
 * who deletes the text has removed the note, not saved an empty one, and a
 * row with `notes: ""` would wear the note mark with nothing behind it.
 */
export function noteOf(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed.slice(0, SET_NOTE_MAX) : null;
}

/** "42 left" once the draft is near the column's limit, otherwise null. */
export function noteCounter(text: string): string | null {
  const left = SET_NOTE_MAX - text.length;
  return left <= SET_NOTE_COUNTER_FROM ? `${Math.max(0, left)} left` : null;
}

/**
 * What a screen reader is told about the limit, or null for nothing.
 *
 * The visible counter changes on every key near the end; announcing each
 * one would read "99 left, 98 left" over the athlete's own typing. So the
 * live region only speaks at a few steps -- when the counter appears, at 50,
 * at 10 and when the note is full -- and is silent between them.
 */
export function noteAnnouncement(text: string): string | null {
  const left = SET_NOTE_MAX - text.length;
  if (left <= 0) return "Note is full";
  if (left === SET_NOTE_COUNTER_FROM || left === 50 || left === 10) return `${left} characters left`;
  return null;
}
