import { describe, expect, it } from "vitest";
import { roundToLoadable } from "./plates";

describe("roundToLoadable", () => {
  it("rounds down to 2.5kg", () => {
    expect(roundToLoadable(144.9)).toBe(142.5);
    expect(roundToLoadable(142.5)).toBe(142.5);
  });

  it("does not lose an exactly loadable weight to floating point", () => {
    // 0.7 * 175 is 122.49999999999999 in IEEE 754.
    expect(roundToLoadable(0.7 * 175)).toBe(122.5);
    expect(roundToLoadable(0.575 * 200)).toBe(115);
    expect(roundToLoadable(0.7 * 350)).toBe(245);
  });

  it("still rounds a genuinely short weight down", () => {
    expect(roundToLoadable(122.49)).toBe(120);
  });
});
