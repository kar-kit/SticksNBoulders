/**
 * A sliding-window limiter for the sign-in method hint.
 *
 * The hint endpoint tells a caller whether an email belongs to an account with
 * no password. That is genuinely useful -- it unsticks an athlete who signed up
 * with Google -- and it is genuinely an enumeration oracle. The rate limit is
 * what keeps the second from mattering: answering one address at a time is a
 * support affordance, answering thousands is a breach.
 *
 * In-memory, so it holds for a single self-hosted instance, which is the whole
 * beta. A multi-instance deploy needs shared state; noted at the call site.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next attempt would be allowed. Zero when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Injected so tests do not sleep. */
  now?: () => number;
}

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  function prune(key: string, at: number): number[] {
    const recent = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
    if (recent.length === 0) hits.delete(key);
    else hits.set(key, recent);
    return recent;
  }

  return {
    /** Records an attempt and says whether it is allowed. */
    check(key: string): RateLimitResult {
      const at = now();
      const recent = prune(key, at);

      if (recent.length >= limit) {
        const oldest = recent[0];
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (at - oldest)) / 1000)),
        };
      }

      hits.set(key, [...recent, at]);
      return { allowed: true, retryAfterSeconds: 0 };
    },

    /** Drops expired entries so a long-running process does not grow forever. */
    sweep(): void {
      const at = now();
      for (const key of [...hits.keys()]) prune(key, at);
    },

    get size(): number {
      return hits.size;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
