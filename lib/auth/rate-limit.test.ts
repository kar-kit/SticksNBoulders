import { createRateLimiter } from "./rate-limit";

describe("rate limiter", () => {
  let clock = 0;
  const now = () => clock;
  const build = () => createRateLimiter({ limit: 3, windowMs: 60_000, now });

  beforeEach(() => {
    clock = 1_000_000;
  });

  it("allows up to the limit", () => {
    const limiter = build();
    for (let i = 0; i < 3; i++) expect(limiter.check("ip").allowed).toBe(true);
  });

  it("blocks the attempt past the limit", () => {
    const limiter = build();
    for (let i = 0; i < 3; i++) limiter.check("ip");
    expect(limiter.check("ip").allowed).toBe(false);
  });

  it("says how long to wait, rounded up to a whole second", () => {
    const limiter = build();
    for (let i = 0; i < 3; i++) limiter.check("ip");
    clock += 10_000;
    const result = limiter.check("ip");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(50);
  });

  it("never reports a wait of zero while blocked", () => {
    // A retry-after of 0 tells the caller to hammer immediately.
    const limiter = build();
    for (let i = 0; i < 3; i++) limiter.check("ip");
    clock += 59_999;
    const result = limiter.check("ip");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("lets the window slide rather than resetting in fixed blocks", () => {
    // A fixed window lets someone spend the whole budget at the end of one
    // block and again at the start of the next.
    const limiter = build();
    limiter.check("ip");
    clock += 30_000;
    limiter.check("ip");
    limiter.check("ip");
    expect(limiter.check("ip").allowed).toBe(false);

    // The first attempt ages out; exactly one slot frees up.
    clock += 30_001;
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(false);
  });

  it("counts each key separately", () => {
    const limiter = build();
    for (let i = 0; i < 3; i++) limiter.check("ip-a");
    expect(limiter.check("ip-a").allowed).toBe(false);
    expect(limiter.check("ip-b").allowed).toBe(true);
  });

  it("forgets a key once its window passes, so memory does not grow forever", () => {
    const limiter = build();
    limiter.check("ip-a");
    limiter.check("ip-b");
    expect(limiter.size).toBe(2);
    clock += 60_001;
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });

  it("allows again once the window has fully passed", () => {
    const limiter = build();
    for (let i = 0; i < 3; i++) limiter.check("ip");
    clock += 60_001;
    expect(limiter.check("ip").allowed).toBe(true);
  });
});
