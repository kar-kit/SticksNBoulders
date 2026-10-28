import { heroFrame, weekAt } from "./hero-geometry";
import { TOTAL_WEEKS } from "./hero-mode";

const view = { width: 640, height: 480 };

describe("heroFrame", () => {
  it("is deterministic, so the server's poster matches the browser's last frame", () => {
    expect(heroFrame(1, view)).toEqual(heroFrame(1, view));
  });

  it("clamps the timeline", () => {
    expect(heroFrame(1.5, view)).toEqual(heroFrame(1, view));
    expect(heroFrame(-1, view)).toEqual(heroFrame(0, view));
  });

  it("starts with one stick and ends with a stick and a boulder", () => {
    // The shadow, then faces. More faces at the end than the start: the boulder.
    const start = heroFrame(0, view).length;
    const end = heroFrame(1, view).length;
    expect(start).toBeGreaterThan(1);
    expect(end).toBeGreaterThan(start);
  });

  it("is busiest mid-build, while the pile is on screen", () => {
    expect(heroFrame(0.6, view).length).toBeGreaterThan(heroFrame(1, view).length);
  });

  it("keeps the finished picture inside the frame", () => {
    for (const poly of heroFrame(1, view)) {
      for (let i = 0; i < poly.points.length; i += 2) {
        expect(poly.points[i]).toBeGreaterThanOrEqual(0);
        expect(poly.points[i]).toBeLessThanOrEqual(view.width);
        expect(poly.points[i + 1]).toBeGreaterThanOrEqual(0);
        expect(poly.points[i + 1]).toBeLessThanOrEqual(view.height);
      }
    }
  });

  it("scales with the box, so a 4:3 canvas draws the same picture as the 4:3 poster", () => {
    const small = heroFrame(1, view)[5].points;
    const big = heroFrame(1, { width: 1280, height: 960 })[5].points;
    big.forEach((n, i) => expect(n).toBeCloseTo(small[i] * 2, 6));
  });
});

describe("weekAt", () => {
  it("runs from week 1 to the last week", () => {
    expect(weekAt(0)).toBe(1);
    expect(weekAt(1)).toBe(TOTAL_WEEKS);
  });
});
