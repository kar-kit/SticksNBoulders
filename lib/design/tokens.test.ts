import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, isLargeText, meetsAA, relativeLuminance } from "./contrast";

/**
 * These read the real stylesheet rather than a copy of the palette. A test that
 * restates the hex values would pass while globals.css drifted underneath it.
 */
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function token(name: string): string {
  const match = new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6});`, "m").exec(css);
  if (!match) throw new Error(`Token --${name} is not defined in app/globals.css`);
  return match[1].toLowerCase();
}

const SURFACES = ["background", "surface", "surface-2"] as const;

describe("contrast maths", () => {
  it("matches the WCAG reference points", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
  });

  it("is symmetric in its arguments", () => {
    expect(contrastRatio("#bc8c5e", "#1d1c22")).toBeCloseTo(
      contrastRatio("#1d1c22", "#bc8c5e"),
      10,
    );
  });

  it("rejects malformed colours rather than scoring them", () => {
    expect(() => relativeLuminance("#fff")).toThrow();
    expect(() => relativeLuminance("rebeccapurple")).toThrow();
  });

  it("applies the large-text threshold at 24px, or 18.66px when bold", () => {
    expect(isLargeText(24)).toBe(true);
    expect(isLargeText(22)).toBe(false);
    expect(isLargeText(19, true)).toBe(true);
    expect(isLargeText(19, false)).toBe(false);
  });
});

describe("text tokens on every surface they sit on", () => {
  // The set row puts --foreground and --muted on --surface; coach tables put
  // them on --surface-2. Any of the three can host any of the three.
  it.each(["foreground", "muted", "muted-2"])(
    "--%s clears AA for normal-size text on all three surfaces",
    (fg) => {
      for (const bg of SURFACES) {
        expect(meetsAA(token(fg), token(bg), 13)).toBe(true);
      }
    },
  );

  it("--muted-2 is the tightest of them, and still clears AA", () => {
    // It carries the 9-10px mono labels, so it is the one that breaks first if
    // anyone darkens the greys. The canvas value #8a898f scored 3.85 here.
    const ratio = contrastRatio(token("muted-2"), token("surface-2"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#8a898f", token("surface-2"))).toBeLessThan(4.5);
  });
});

describe("the fill and line split", () => {
  it("accent fill carries its own label at AA", () => {
    expect(meetsAA(token("on-accent"), token("accent-fill"), 16, true)).toBe(true);
  });

  it("pressed accent carries its own label at AA", () => {
    expect(meetsAA(token("on-accent-pressed"), token("accent-pressed"), 16, true)).toBe(true);
  });

  it("danger fill carries its own label at AA, including the delete action", () => {
    // The canvas put #f2f1ef on #c2645a here at 3.53:1. A destructive label is
    // the last place to accept that.
    expect(meetsAA(token("on-danger-fill"), token("danger-fill"), 15, true)).toBe(true);
  });

  it("success clears AA on every surface", () => {
    for (const bg of SURFACES) {
      expect(meetsAA(token("success"), token(bg), 13)).toBe(true);
    }
  });

  it.each(["accent-line", "danger-line"])(
    "--%s is large-text-only, which is why a separate fill token exists",
    (line) => {
      // Documents the constraint rather than asserting a nicety: these two fail
      // AA for normal text on the base background, pass for 24px+, and must
      // never be used as a small-text colour or a fill behind one.
      expect(meetsAA(token(line), token("background"), 13)).toBe(false);
      expect(meetsAA(token(line), token("background"), 24)).toBe(true);
    },
  );

  it("keeps a fill token distinct from its line token", () => {
    expect(token("accent-fill")).not.toBe(token("accent-line"));
    expect(token("danger-fill")).not.toBe(token("danger-line"));
  });
});

describe("stylesheet invariants", () => {
  it("is dark-only, with no light-mode escape hatch", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it("sets tabular lining figures globally, not per component", () => {
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums/);
  });
});
