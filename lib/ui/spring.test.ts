import { readFileSync } from "node:fs";
import path from "node:path";
import { settleTime, springAt, springEasing, SPRINGS } from "./spring";

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

/** The value of a custom property in globals.css, `nth` occurrence. */
function declared(name: string, nth = 0): string | undefined {
  const all = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))];
  return all[nth]?.[1].trim();
}

describe("springAt", () => {
  it("starts at rest and ends there", () => {
    for (const spring of Object.values(SPRINGS)) {
      expect(springAt(spring, 0)).toBeCloseTo(0, 6);
      expect(springAt(spring, 2)).toBeCloseTo(1, 4);
    }
  });

  it("overshoots only below critical damping", () => {
    const peak = (damping: number) =>
      Math.max(...Array.from({ length: 2000 }, (_, i) => springAt({ response: 0.4, damping }, i / 1000)));
    expect(peak(1)).toBeLessThanOrEqual(1);
    expect(peak(0.6)).toBeGreaterThan(1.05);
  });

  it("settles sooner when it is stiffer", () => {
    expect(settleTime({ response: 0.3, damping: 0.85 })).toBeLessThan(settleTime({ response: 0.5, damping: 0.85 }));
  });
});

describe("springEasing", () => {
  it("is a well-formed linear(): starts at 0, ends at 1, stops in order", () => {
    const { easing } = springEasing(SPRINGS.bounce);
    expect(easing).toMatch(/^linear\(0, .*, 1\)$/);
    const at = [...easing.matchAll(/ ([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at.every((p) => p > 0 && p < 100)).toBe(true);
  });

  it("stays within its tolerance of the real curve", () => {
    const spring = SPRINGS.spring;
    const { easing } = springEasing(spring);
    const stops = easing
      .slice("linear(".length, -1)
      .split(", ")
      .map((stop, i, all) => {
        const [y, p] = stop.split(" ");
        return [p ? parseFloat(p) / 100 : i === 0 ? 0 : i === all.length - 1 ? 1 : NaN, Number(y)] as const;
      });
    const settle = settleTime(spring);
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      const k = stops.findIndex(([at]) => at >= t);
      const [t1, y1] = stops[k];
      const [t0, y0] = stops[Math.max(0, k - 1)];
      const y = t1 === t0 ? y1 : y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
      // 0.2% simplification plus the 0.1% settle cut-off and rounding.
      expect(Math.abs(y - springAt(spring, t * settle))).toBeLessThan(0.0035);
    }
  });
});

describe("globals.css", () => {
  // `npx tsx scripts/spring-easings.mts` regenerates them.
  it.each(Object.entries(SPRINGS))("--ease-%s is the spring's curve, at its own duration", (name, spring) => {
    const { easing, ms } = springEasing(spring);
    // The first declaration is the cubic-bezier fallback, the second the spring.
    expect(declared(`--ease-${name}`, 0)).toMatch(/^cubic-bezier\(/);
    expect(declared(`--ease-${name}`, 1)).toBe(easing);
    expect(declared(`--transition-duration-${name}`)).toBe(`${ms}ms`);
  });

  it("serves the springs only where linear() is supported", () => {
    const block = css.slice(css.indexOf("@supports (transition-timing-function: linear(0, 1))"));
    expect(block.indexOf("--ease-spring: linear(")).toBeGreaterThan(0);
  });
});
