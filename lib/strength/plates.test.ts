import { describe, expect, it } from "vitest";
import { LOADABLE_INCREMENT_LB, roundToLoadable } from "./plates";
import { loadFromInput, loadIn } from "@/lib/units";

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

describe("roundToLoadable for an athlete who trains in pounds", () => {
  it("floors to a 5 lb jump in pounds, not a 2.5 kg one", () => {
    // 152.5 kg is 336.2 lb: nobody can load that on pound plates.
    expect(loadIn(roundToLoadable(152.5, "lb"), "lb")).toBe(335);
    expect(LOADABLE_INCREMENT_LB).toBe(5);
  });

  it("keeps a weight that is already loadable in pounds", () => {
    expect(loadIn(roundToLoadable(loadFromInput(315, "lb"), "lb"), "lb")).toBe(315);
  });

  it("stores the answer as kilos that read back as the exact plate total", () => {
    const kg = roundToLoadable(100, "lb"); // 220.46 lb -> 220 lb
    expect(kg).toBe(loadFromInput(220, "lb"));
    expect(loadIn(kg, "lb")).toBe(220);
  });

  it("is unchanged for kilos, which stays the default", () => {
    expect(roundToLoadable(144.9, "kg")).toBe(142.5);
    expect(roundToLoadable(144.9)).toBe(142.5);
  });
});
