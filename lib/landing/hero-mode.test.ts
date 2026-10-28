import {
  chooseHero,
  FINAL_LABEL,
  FINAL_POSE,
  LABELS,
  momentAt,
  PLATE_RADIUS,
  SAMPLE_FRAMES,
  tooSlow,
  TOTAL_MS,
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
  it("starts and ends on the poster, the logo", () => {
    for (const ms of [0, TOTAL_MS, TOTAL_MS * 3]) {
      expect(momentAt(ms)).toEqual({ pose: FINAL_POSE, label: FINAL_LABEL });
    }
  });

  it("tells the story in order: logo, deadlift 1 to 4 plates, squat, bench, logo", () => {
    expect(LABELS).toEqual([
      "Sticks and boulders",
      "Deadlift \u00b7 1 plate",
      "Deadlift \u00b7 2 plates",
      "Deadlift \u00b7 3 plates",
      "Deadlift \u00b7 4 plates",
      "Squat \u00b7 3 plates",
      "Bench \u00b7 2 plates",
      "Sticks and boulders",
    ]);
  });

  it("pulls each deadlift from the floor to lockout, with the plates it says", () => {
    for (const n of [1, 2, 3, 4]) {
      const label = `Deadlift \u00b7 ${n} plate${n === 1 ? "" : "s"}`;
      let low = Infinity;
      let high = -Infinity;
      for (let ms = 0; ms < TOTAL_MS; ms += 20) {
        const { pose, label: shown } = momentAt(ms);
        if (shown !== label || Math.abs(pose.plates - n) > 1e-9) continue;
        low = Math.min(low, pose.barY);
        high = Math.max(high, pose.barY);
      }
      expect(low).toBeCloseTo(PLATE_RADIUS, 5);
      expect(high - low).toBeGreaterThan(0.75);
    }
  });

  it("bends the bar as it leaves the floor, more with more plates", () => {
    const peakBend = (n: number) => {
      let peak = 0;
      for (let ms = 0; ms < TOTAL_MS; ms += 10) {
        const { pose, label } = momentAt(ms);
        if (label.startsWith("Deadlift") && Math.abs(pose.plates - n) < 1e-9) peak = Math.max(peak, pose.bend);
      }
      return peak;
    };
    expect(peakBend(4)).toBeGreaterThan(peakBend(1));
  });

  it("only stands the rack up for the squat and the bench, and the bench only for the bench", () => {
    for (let ms = 0; ms < TOTAL_MS; ms += 50) {
      const { pose, label } = momentAt(ms);
      if (label.startsWith("Deadlift")) expect(pose.rack).toBe(0);
      if (pose.bench > 0) expect(["Bench \u00b7 2 plates", "Sticks and boulders"]).toContain(label);
    }
  });

  it("never jumps: no value moves far between two 60 Hz frames", () => {
    let last = momentAt(0).pose;
    for (let ms = 16; ms <= TOTAL_MS; ms += 16) {
      const { pose } = momentAt(ms);
      for (const key of Object.keys(pose) as (keyof typeof pose)[]) {
        expect(Math.abs(pose[key] - last[key])).toBeLessThan(0.12);
      }
      last = pose;
    }
  });
});
