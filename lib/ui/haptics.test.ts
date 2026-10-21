import { haptic, HAPTICS, type HapticKind } from "./haptics";

describe("haptic", () => {
  const kinds = Object.keys(HAPTICS) as HapticKind[];

  it("plays each kind's own pattern where the platform can vibrate", () => {
    for (const kind of kinds) {
      const vibrate = vi.fn(() => true);
      expect(haptic(kind, { vibrate })).toBe(true);
      expect(vibrate).toHaveBeenCalledWith([...HAPTICS[kind]]);
    }
  });

  it("hands the platform a copy, so nothing it does can change a pattern", () => {
    const vibrate = vi.fn((pattern: number[]) => {
      pattern.length = 0;
      return true;
    });
    haptic("success", { vibrate });
    expect(HAPTICS.success).toEqual([12, 60, 18]);
  });

  it("is a no-op, and does not throw, wherever it cannot", () => {
    // No navigator (the server), no vibrate (iOS Safari), refused (no user
    // activation yet in Chrome), and thrown.
    expect(haptic("light", undefined)).toBe(false);
    expect(haptic("light", {})).toBe(false);
    expect(haptic("light", { vibrate: () => false })).toBe(false);
    expect(
      haptic("light", {
        vibrate: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });

  it("reads the real navigator by default", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
    try {
      expect(haptic("medium")).toBe(true);
      expect(vibrate).toHaveBeenCalledWith([...HAPTICS.medium]);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).vibrate;
    }
    // jsdom has no vibrate of its own: the iPhone case.
    expect(haptic("medium")).toBe(false);
  });

  it("does not stay silent under reduced motion", () => {
    // A buzz moves nothing on screen (docs/athlete-motion.md).
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      const vibrate = vi.fn(() => true);
      expect(haptic("success", { vibrate })).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
