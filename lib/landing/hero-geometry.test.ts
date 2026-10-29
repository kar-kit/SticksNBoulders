import { FINAL_POSE, heroFrame } from "./hero-geometry";
import { IMPACTS, momentAt, TOTAL_MS } from "./hero-mode";

const view = { width: 640, height: 480 };

describe("heroFrame", () => {
  it("is deterministic, so the server's poster matches the browser's first and last frame", () => {
    expect(heroFrame(FINAL_POSE, view)).toEqual(heroFrame(FINAL_POSE, view));
  });

  it("keeps every frame of the story inside the box", () => {
    // Every 50 ms: the morphs, every plate going on and off, the rack and
    // the bench rising, the squat walkout, the press and the camera moves.
    for (let ms = 0; ms <= TOTAL_MS; ms += 50) {
      for (const poly of heroFrame(momentAt(ms).pose, view)) {
        for (let i = 0; i < poly.points.length; i += 2) {
          const [x, y] = [poly.points[i], poly.points[i + 1]];
          if (x < 0 || x > view.width || y < 0 || y > view.height) {
            throw new Error(`frame at ${ms} ms draws outside the box at ${x.toFixed(1)}, ${y.toFixed(1)}`);
          }
        }
      }
    }
  });

  it("draws more as the bar is loaded: four plates a side is busier than one", () => {
    const pose = momentAt(1).pose;
    const one = { ...pose, form: 1, deck: 1, plates: 1 };
    const four = { ...one, plates: 4 };
    expect(heroFrame(four, view).length).toBeGreaterThan(heroFrame(one, view).length);
  });

  it("only draws the rack and bench when they are up", () => {
    const base = { ...FINAL_POSE, form: 1, deck: 1 };
    const bare = heroFrame(base, view).length;
    expect(heroFrame({ ...base, rack: 1 }, view).length).toBeGreaterThan(bare);
    expect(heroFrame({ ...base, bench: 1 }, view).length).toBeGreaterThan(bare);
  });

  it("throws chips on an impact, and draws the floor's dust ring", () => {
    for (const hit of IMPACTS) {
      const { pose, fx } = momentAt(hit.at + 120);
      expect(heroFrame(pose, view, fx).length).toBeGreaterThan(heroFrame(pose, view).length + 10);
    }
  });

  it("moves the whole picture with the shake", () => {
    const { pose } = momentAt(1);
    const still = heroFrame(pose, view)[3].points;
    const shaken = heroFrame(pose, view, { shakeX: 0.01, shakeY: 0, bursts: [] })[3].points;
    expect(shaken[0] - still[0]).toBeCloseTo(4.8, 6);
  });

  it("scales with the box, so a 4:3 canvas draws the same picture as the 4:3 poster", () => {
    const small = heroFrame(FINAL_POSE, view)[5].points;
    const big = heroFrame(FINAL_POSE, { width: 1280, height: 960 })[5].points;
    big.forEach((n, i) => expect(n).toBeCloseTo(small[i] * 2, 6));
  });
});
