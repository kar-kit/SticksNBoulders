import { Users } from "node-appwrite";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { TICKET_TTL_MS } from "./ticket";

/**
 * The Appwrite JWTs the clip stream route has minted, kept for reuse.
 *
 * Why it exists: a `<video>` element makes many requests for one clip -- the
 * first load, then a Range request for every seek, frame step and loop past
 * the buffer -- and the stream route used to mint a fresh JWT
 * (`Users.createJWT`) for every one of them. That is a round trip to Appwrite
 * through the Cloudflare tunnel, about 80 ms measured on 2 Nov 2026, paid
 * before the first byte of every seek. Warm Vercel instances keep module
 * state between requests, so the route keeps the JWT here and a player's
 * range requests share one mint.
 *
 * The security model does not move:
 *
 *   - **Keyed on the ticket's user, and only on that.** The key is the
 *     `userId` from a ticket whose signature has already been checked, so a
 *     cached JWT can only ever be handed to a request that the signed ticket
 *     says is the same user. One user's JWT is never used for another's ticket.
 *   - **Identity, not authority, still.** A JWT only says who is asking;
 *     Appwrite evaluates the file's permissions on every read, live. A coach
 *     unlinked mid-scrub still gets 404 on the next range request, cached JWT
 *     or not, because team membership is checked at read time, not baked into
 *     the token.
 *   - **The ticket is still checked on every request**, before this is
 *     consulted. A reused JWT never extends what an expired ticket can open.
 *   - **Never logged.** Nothing here writes a JWT or a ticket anywhere but
 *     this map.
 */

/**
 * How long a minted JWT is reused for.
 *
 * Two lifetimes bound it, and it sits comfortably inside both:
 *
 *   - **The JWT's own.** The route calls `createJWT` without `duration`, so
 *     Appwrite's default applies: 900 seconds (node-appwrite 28's docs for
 *     `Users.createJWT`: "Default duration is 900 seconds"). Four minutes
 *     leaves eleven of slack, so a reused JWT is never close to expiring
 *     mid-request even with clock skew between Vercel and the instance.
 *   - **The ticket's.** `TICKET_TTL_MS` is five minutes. Staying under it
 *     means a cached JWT never outlives the window a single playback URL is
 *     good for, which keeps "a JWT for this user exists in memory" as short as
 *     the thing that justified minting it. Derived rather than hard-coded, so
 *     shortening the ticket shortens this too.
 */
export const JWT_REUSE_MS = Math.min(4 * 60 * 1000, TICKET_TTL_MS - 60 * 1000);

/**
 * The most users held at once. A Review Queue session is one coach, so a warm
 * instance in the beta holds a handful; the cap is there so a burst of
 * distinct users (or a bug) cannot grow the map without limit. At the cap the
 * expired entries go first, then the oldest.
 */
export const MAX_CACHED_JWTS = 500;

interface Entry {
  /**
   * The mint itself, not its result: several range requests arrive together
   * when a player starts, and without this every one of them would miss and
   * mint. They share one promise instead.
   */
  jwt: Promise<string>;
  /** Epoch milliseconds after which this entry is not reused. */
  reuseUntil: number;
}

/** What a caller gets: the JWT, and whether it came from an earlier mint. */
export interface JwtLease {
  jwt: string;
  /**
   * True when an earlier request minted it. Only a reused JWT is worth
   * retrying on a 401 -- a fresh one refused is refused for a real reason.
   */
  reused: boolean;
  /** Which entry this was, so a 401 evicts this one and not a newer mint. */
  entry: object;
}

export class ClipJwtCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly mint: (userId: string) => Promise<string>,
    // A call, not `Date.now` itself: a captured reference would ignore a
    // clock that tests (or anything else) swap in later.
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * A JWT for `userId`: the cached one while it is inside its reuse window,
   * else a new mint. A mint that fails is not cached, so the next request
   * tries again rather than inheriting the failure.
   */
  async get(userId: string): Promise<JwtLease> {
    const now = this.now();
    const cached = this.entries.get(userId);
    if (cached && cached.reuseUntil > now) {
      return { jwt: await cached.jwt, reused: true, entry: cached };
    }
    if (cached) this.entries.delete(userId);

    const entry: Entry = { jwt: this.mint(userId), reuseUntil: now + JWT_REUSE_MS };
    this.makeRoom(now);
    this.entries.set(userId, entry);
    try {
      return { jwt: await entry.jwt, reused: false, entry };
    } catch (error) {
      this.forget(userId, entry);
      throw error;
    }
  }

  /**
   * Drops `userId`'s entry, but only if it is still `entry`. A concurrent
   * request may already have replaced a refused JWT with a fresh one, and
   * evicting that would cost the next request a pointless mint.
   */
  forget(userId: string, entry: object): void {
    if (this.entries.get(userId) === entry) this.entries.delete(userId);
  }

  /** Empties the map. For tests, which share one module instance. */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private makeRoom(now: number): void {
    if (this.entries.size < MAX_CACHED_JWTS) return;
    for (const [userId, entry] of this.entries) {
      if (entry.reuseUntil <= now) this.entries.delete(userId);
    }
    // Still full: drop the oldest. A Map iterates in insertion order, and
    // entries are never re-inserted on a hit, so the first key is the oldest
    // mint -- the one closest to expiring anyway.
    while (this.entries.size >= MAX_CACHED_JWTS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/**
 * Mints a JWT for `userId` with the admin key. The key mints a token FOR the
 * user and never reads a file itself; the bytes are fetched with the user's
 * own authority.
 */
async function mintClipJwt(userId: string): Promise<string> {
  return (await new Users(createServerClient(serverAppwriteConfig())).createJWT({ userId })).jwt;
}

/**
 * The one instance the stream route uses. Module scope on purpose: that is
 * what survives between requests on a warm Vercel instance. A cold start
 * begins empty, which costs one mint -- exactly what every request cost before.
 */
export const clipJwts = new ClipJwtCache(mintClipJwt);
