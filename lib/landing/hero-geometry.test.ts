import { bendAt, FINAL_POSE, heroFrame } from "./hero-geometry";
import { REST_YAW, type Pose } from "./hero-mode";

const view = { width: 640, height: 480 };
const pose = (build: number, lift: number): Pose => ({ build, lift, yaw: REST_YAW });

describe("heroFrame", () => {
  it("is deterministic, so the server's poster matches the browser's last frame", () => {
    expect(heroFrame(FINAL_POSE, view)).toEqual(heroFrame(FINAL_POSE, view));
  });

  it("clamps a pose past either end", () => {
    expect(heroFrame(pose(1.5, 2), view)).toEqual(heroFrame(pose(1, 1), view));
    expect(heroFrame(pose(-1, -1), view)).toEqual(heroFrame(pose(0, 0), view));
  });

  it("is busiest mid-build, while the heaps of sticks are on screen", () => {
    expect(heroFrame(pose(0.55, 0), view).length).toBeGreaterThan(heroFrame(FINAL_POSE, view).length);
    expect(heroFrame(pose(0.55, 0), view).length).toBeGreaterThan(heroFrame(pose(0, 0), view).length);
  });

  it("keeps the poster inside the frame", () => {
    for (const poly of heroFrame(FINAL_POSE, view)) {
      for (let i = 0; i < poly.points.length; i += 2) {
        expect(poly.points[i]).toBeGreaterThanOrEqual(0);
        expect(poly.points[i]).toBeLessThanOrEqual(view.width);
        expect(poly.points[i + 1]).toBeGreaterThanOrEqual(0);
        expect(poly.points[i + 1]).toBeLessThanOrEqual(view.height);
      }
    }
  });

  it("keeps every frame of a rep inside the frame, swing and all", () => {
    for (const lift of [0, 0.25, 0.5, 1]) {
      for (const yaw of [REST_YAW, REST_YAW - 0.175, REST_YAW - 0.35]) {
        for (const poly of heroFrame({ build: 1, lift, yaw }, view)) {
          for (let i = 0; i < poly.points.length; i += 2) {
            expect(poly.points[i]).toBeGreaterThanOrEqual(0);
            expect(poly.points[i]).toBeLessThanOrEqual(view.width);
            expect(poly.points[i + 1]).toBeGreaterThanOrEqual(0);
            expect(poly.points[i + 1]).toBeLessThanOrEqual(view.height);
          }
        }
      }
    }
  });

  it("scales with the box, so a 4:3 canvas draws the same picture as the 4:3 poster", () => {
    const small = heroFrame(FINAL_POSE, view)[5].points;
    const big = heroFrame(FINAL_POSE, { width: 1280, height: 960 })[5].points;
    big.forEach((n, i) => expect(n).toBeCloseTo(small[i] * 2, 6));
  });
});

describe("bendAt", () => {
  it("is straight on the floor", () => {
    expect(bendAt(0)).toBe(0);
  });

  it("bends most as the plates break from the floor, and keeps a little at lockout", () => {
    expect(bendAt(0.25)).toBeGreaterThan(bendAt(1));
    expect(bendAt(1)).toBeGreaterThan(0);
  });
});
