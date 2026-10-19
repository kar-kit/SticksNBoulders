import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REST_MS,
  extendRest,
  buzzRestOver,
  formatRest,
  isRestOver,
  REST_BUZZ,
  restJustEnded,
  restRemainingMs,
  startRest,
  type RestTimer,
} from "./rest-timer";

const at = (iso: string) => new Date(iso);
const START = at("2026-09-14T10:00:00Z");
const timer: RestTimer = { startedAt: START, restMs: DEFAULT_REST_MS };

describe("restRemainingMs", () => {
  it("is a function of the clock, not of how often it was asked", () => {
    // The property the whole design rests on. A phone that slept through the
    // rest, was reloaded, or took a call comes back showing the truth -- which
    // a tick counter cannot do, and is why there is no interval in that file.
    expect(restRemainingMs(timer, START)).toBe(120_000);
    expect(restRemainingMs(timer, at("2026-09-14T10:00:45Z"))).toBe(75_000);
    expect(restRemainingMs(timer, at("2026-09-14T10:02:00Z"))).toBe(0);
  });

  it("stops at zero rather than counting overtime", () => {
    // The bar dismisses itself at zero, so there is no "how far over" to show.
    expect(restRemainingMs(timer, at("2026-09-14T10:02:12Z"))).toBe(0);
    expect(restRemainingMs(timer, at("2026-09-14T11:30:00Z"))).toBe(0);
  });

  it("knows when the rest is over", () => {
    expect(isRestOver(timer, at("2026-09-14T10:01:59Z"))).toBe(false);
    expect(isRestOver(timer, at("2026-09-14T10:02:00Z"))).toBe(true);
  });
});

describe("extendRest", () => {
  it("adds thirty seconds to the rest, not to a countdown", () => {
    const longer = extendRest(timer);
    expect(longer.restMs).toBe(150_000);
    expect(longer.startedAt).toBe(START);
  });

  it("is additive across taps", () => {
    // Three presses is ninety seconds. An athlete who taps it twice while the
    // number is moving must not get thirty.
    const thrice = extendRest(extendRest(extendRest(timer)));
    expect(thrice.restMs).toBe(DEFAULT_REST_MS + 90_000);
    expect(restRemainingMs(thrice, at("2026-09-14T10:02:00Z"))).toBe(90_000);
  });

  it("extends a rest that has already run out", () => {
    const late = extendRest(timer);
    expect(restRemainingMs(late, at("2026-09-14T10:02:20Z"))).toBe(10_000);
  });
});

describe("formatRest", () => {
  it("reads as a clock", () => {
    expect(formatRest(120_000)).toBe("2:00");
    expect(formatRest(71_000)).toBe("1:11");
    expect(formatRest(9_000)).toBe("0:09");
    expect(formatRest(0)).toBe("0:00");
  });

  it("never shows negative time", () => {
    expect(formatRest(-12_000)).toBe("0:00");
    expect(formatRest(-95_000)).toBe("0:00");
  });

  it("does not round a part-second up into the next tick", () => {
    // 1999ms is still one second on screen, not two. Off by one here means the
    // timer visibly skips a number every minute or so.
    expect(formatRest(1_999)).toBe("0:01");
  });
});

describe("startRest", () => {
  it("starts at two minutes, because there is no configuration", () => {
    expect(startRest(START)).toEqual({ startedAt: START, restMs: 120_000 });
  });
});

describe("restJustEnded", () => {
  it("is true for the few seconds after zero, so the screen buzzes once on time", () => {
    expect(restJustEnded(timer, at("2026-09-14T10:01:59Z"))).toBe(false);
    expect(restJustEnded(timer, at("2026-09-14T10:02:00Z"))).toBe(true);
    expect(restJustEnded(timer, at("2026-09-14T10:02:02Z"))).toBe(true);
  });

  it("is false for a rest that ended while the phone was away", () => {
    // Coming back to a locked phone five minutes later: the bar just goes,
    // nothing buzzes to announce something that happened long ago.
    expect(restJustEnded(timer, at("2026-09-14T10:07:00Z"))).toBe(false);
  });
});

describe("buzzRestOver", () => {
  it("vibrates where the platform can", () => {
    const vibrate = vi.fn(() => true);
    expect(buzzRestOver({ vibrate })).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([...REST_BUZZ]);
  });

  it("does nothing, and does not throw, where it cannot", () => {
    // iOS Safari has no vibrate; some browsers throw without a user gesture.
    expect(buzzRestOver(undefined)).toBe(false);
    expect(buzzRestOver({})).toBe(false);
    expect(
      buzzRestOver({
        vibrate: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });
});
