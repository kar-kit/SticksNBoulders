/**
 * The shape of a coach's invite code.
 *
 * Pure, and deliberately separate from anything that writes one: this is the
 * half that has to be right when a code is read aloud across a gym floor and
 * typed back one-handed by somebody who has not signed in yet.
 *
 * Three decisions, all of them about that moment rather than about storage:
 *
 *   1. The alphabet excludes I, L, O, U, 0 and 1. Every pair of characters
 *      people confuse when transcribing is broken by removing one side of it,
 *      so a mis-read code fails to exist rather than quietly resolving to a
 *      different coach. U goes for a different reason -- it is the letter that
 *      turns a random five-character string into a word somebody has to read
 *      out in public.
 *   2. Input is normalised, not validated strictly. "snb 4f7k2", "4F7K2" and
 *      "SNB-4f7k2" are the same code, for the same reason exercise names are
 *      normalised before they are matched.
 *   3. The code IS the Appwrite row id. Uniqueness then comes from the primary
 *      key rather than from an index anyone has to trust, and redeeming one at
 *      Order 16 is a single point read instead of a query.
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_PREFIX = "SNB-";
export const INVITE_BODY_LENGTH = 5;

/**
 * 30^5 = 24.3 million. Against the low thousands of codes this product will
 * ever hold, a blind guess lands about once in ten thousand attempts, and the
 * athlete is shown the coach's name and asked to confirm before anything is
 * linked. That makes guessing a nuisance rather than a breach -- but it is
 * also why redemption at Order 16 needs a rate limit, not just a lookup.
 */
export const INVITE_KEYSPACE = ALPHABET.length ** INVITE_BODY_LENGTH;

/** Bytes at or above this would bias the low end of the alphabet. Rejected. */
const UNBIASED_CEILING = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

type RandomBytes = (length: number) => Uint8Array;

const cryptoBytes: RandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

/**
 * A fresh code. Random, never derived from the coach's id -- a code you can
 * work out from a user id is a code anyone can work out.
 *
 * `random` is injected so a test can pin the output; nothing in the app passes
 * it, and the default is a CSPRNG.
 */
export function generateInviteCode(random: RandomBytes = cryptoBytes): string {
  let body = "";
  while (body.length < INVITE_BODY_LENGTH) {
    // Over-asks, because rejected bytes are expected: 16 of every 256 fall
    // above the ceiling.
    for (const byte of random(INVITE_BODY_LENGTH)) {
      if (byte >= UNBIASED_CEILING) continue;
      body += ALPHABET[byte % ALPHABET.length];
      if (body.length === INVITE_BODY_LENGTH) break;
    }
  }
  return INVITE_PREFIX + body;
}

/**
 * What a typed code means. Returns null when it cannot mean anything.
 *
 * Case, spaces, hyphens and a missing prefix are all forgiven. A character
 * outside the alphabet is not: the alphabet exists so that a transcription
 * error is visible here rather than resolving to somebody else's code.
 */
export function normaliseInviteCode(typed: string): string | null {
  const stripped = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Length first, prefix second. S, N and B are all in the alphabet, so
  // SNB-SNB23 is a code this generator can produce -- and stripping "SNB"
  // unconditionally would turn the bare body somebody typed into "23" and
  // refuse a perfectly good code.
  const body =
    stripped.length === INVITE_BODY_LENGTH
      ? stripped
      : stripped.startsWith("SNB")
        ? stripped.slice(3)
        : stripped;
  if (body.length !== INVITE_BODY_LENGTH) return null;
  for (const character of body) {
    if (!ALPHABET.includes(character)) return null;
  }
  return INVITE_PREFIX + body;
}

/** Whether a string is already a well-formed code. */
export const isInviteCode = (value: string): boolean => normaliseInviteCode(value) === value;
