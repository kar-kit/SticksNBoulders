// @vitest-environment node
import { ClipJwtCache, JWT_REUSE_MS, MAX_CACHED_JWTS } from "./clip-jwt";

/**
 * The cache on its own, with the mint and the clock injected. The route tests
 * cover reuse, per-user keys, expiry and the 401 retry end to end; these
 * cover what is impractical there: the size cap and the eviction rules.
 */

function harness() {
  let now = 1_000_000;
  const minted: string[] = [];
  const cache = new ClipJwtCache(
    async (userId) => {
      minted.push(userId);
      return `jwt-${userId}-${minted.length}`;
    },
    () => now,
  );
  return { cache, minted, advance: (ms: number) => (now += ms) };
}

describe("ClipJwtCache", () => {
  it("never holds more than MAX_CACHED_JWTS users, dropping the oldest first", async () => {
    const { cache, minted } = harness();
    for (let i = 0; i <= MAX_CACHED_JWTS; i++) await cache.get(`user-${i}`);

    expect(cache.size).toBe(MAX_CACHED_JWTS);
    // The newest is still cached; the oldest had to go and is minted again.
    await cache.get(`user-${MAX_CACHED_JWTS}`);
    expect(minted).toHaveLength(MAX_CACHED_JWTS + 1);
    await cache.get("user-0");
    expect(minted).toHaveLength(MAX_CACHED_JWTS + 2);
  });

  it("drops expired entries before live ones when full", async () => {
    const { cache, minted, advance } = harness();
    await cache.get("stale");
    advance(JWT_REUSE_MS);
    for (let i = 1; i < MAX_CACHED_JWTS; i++) await cache.get(`user-${i}`);

    await cache.get("newcomer");

    // The stale entry made the room; every live one survived.
    expect(cache.size).toBe(MAX_CACHED_JWTS);
    const before = minted.length;
    await cache.get("user-1");
    expect(minted).toHaveLength(before);
  });

  it("forgets an entry only if it is still the one the caller was given", async () => {
    const { cache, minted } = harness();
    const first = await cache.get("coach");
    cache.forget("coach", first.entry);
    const second = await cache.get("coach");

    // A late eviction of the first must not drop its replacement.
    cache.forget("coach", first.entry);
    const third = await cache.get("coach");

    expect(minted).toEqual(["coach", "coach"]);
    expect(third).toMatchObject({ jwt: second.jwt, reused: true });
  });

  it("reports a fresh mint as not reused and a hit as reused", async () => {
    const { cache } = harness();
    expect((await cache.get("coach")).reused).toBe(false);
    expect((await cache.get("coach")).reused).toBe(true);
  });
});
