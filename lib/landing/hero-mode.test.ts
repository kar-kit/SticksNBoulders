import {
  BUILD_MS,
  chooseHero,
  FINAL_LABEL,
  FINAL_POSE,
  HOLD_MS,
  momentAt,
  PAUSE_MS,
  REPS,
  REST_YAW,
  REWIND_MS,
  SAMPLE_FRAMES,
  tooSlow,
  TOTAL_MS,
  TOTAL_WEEKS,
  type HeroEnvironment,
} from "./hero-mode";

const capable: HeroEnvironment = { reducedMotion: false, saveData: false, canvas: true, cores: 8 };

describe("chooseHero", () => {
  it("animates on a capable device", () => {
    expect(chooseHero(capable)).toBe("animate");
  });

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["Save-Data", { saveData: true }],
    ["no canvas", { canvas: false }],
    ["two cores", { cores: 2 }],
  ])("stays still with %s", (_, over) => {
    expect(chooseHero({ ...capable, ...over })).toBe("still");
  });

  it("animates when the browser will not say how many cores it has", () => {
    expect(chooseHero({ ...capable, cores: undefined })).toBe("animate");
  });
});

describe("tooSlow", () => {
  const frames = (ms: number, n = SAMPLE_FRAMES) => Array.from({ length: n }, () => ms);

  it("does not judge before the sample is full", () => {
    expect(tooSlow(frames(100, SAMPLE_FRAMES - 1))).toBe(false);
  });

  it("passes a device at 60 fps", () => {
    expect(tooSlow(frames(16.7))).toBe(false);
  });

  it("fails a device under 30 fps", () => {
    expect(tooSlow(frames(50))).toBe(true);
  });

  it("forgives a few long frames: it is the median that counts", () => {
    const gaps = frames(16.7);
    gaps[0] = gaps[1] = gaps[2] = 400;
    expect(tooSlow(gaps)).toBe(false);
  });
});

describe("momentAt", () => {
  it("opens and ends on the poster, the last rep locked out", () => {
    for (const ms of [0, TOTAL_MS, TOTAL_MS * 3]) {
      expect(momentAt(ms)).toEqual({ pose: FINAL_POSE, label: FINAL_LABEL });
    }
  });

  it("rewinds to one twig on the floor", () => {
    const { pose, label } = momentAt(HOLD_MS + REWIND_MS + PAUSE_MS / 2);
    expect(pose.build).toBe(0);
    expect(pose.lift).toBe(0);
    expect(label).toBe("Week 1");
  });

  it("counts weeks while the bar is being made, then reps", () => {
    const building = momentAt(HOLD_MS + REWIND_MS + PAUSE_MS + BUILD_MS * 0.4);
    expect(building.pose.lift).toBe(0);
    expect(building.label).toMatch(/^Week \d+$/);
    const firstPull = momentAt(HOLD_MS + REWIND_MS + PAUSE_MS + BUILD_MS * 0.95);
    expect(firstPull.pose.build).toBe(1);
    expect(firstPull.pose.lift).toBeGreaterThan(0);
    expect(firstPull.label).toBe(`Week ${TOTAL_WEEKS} \u00b7 Rep 1`);
  });

  it("does a triple: the bar touches the floor twice after the first pull", () => {
    const labels = new Set<string>();
    let touches = 0;
    let down = false;
    const storyEnd = HOLD_MS + REWIND_MS + PAUSE_MS + BUILD_MS;
    for (let ms = storyEnd; ms <= TOTAL_MS; ms += 20) {
      const { pose, label } = momentAt(ms);
      labels.add(label);
      if (pose.lift === 0 && !down) touches++;
      down = pose.lift === 0;
    }
    expect(touches).toBe(REPS - 1);
    expect([...labels]).toEqual([1, 2, 3].map((n) => `Week ${TOTAL_WEEKS} \u00b7 Rep ${n}`));
  });

  it("swings the camera away and back without a jump", () => {
    let last = momentAt(0).pose.yaw;
    for (let ms = 16; ms <= TOTAL_MS; ms += 16) {
      const { yaw } = momentAt(ms).pose;
      expect(Math.abs(yaw - last)).toBeLessThan(0.01);
      last = yaw;
    }
    expect(momentAt(TOTAL_MS / 2).pose.yaw).not.toBeCloseTo(REST_YAW);
  });
});
