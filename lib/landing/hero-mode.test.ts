import {
  BURST_SECONDS,
  chooseHero,
  FINAL_LABEL,
  FINAL_POSE,
  IMPACTS,
  LABELS,
  momentAt,
  NO_FX,
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
  it("starts and ends on the poster, the logo, with nothing shaking", () => {
    for (const ms of [0, TOTAL_MS, TOTAL_MS * 3]) {
      expect(momentAt(ms)).toEqual({ pose: FINAL_POSE, label: FINAL_LABEL, fx: NO_FX });
    }
  });

  it("tells the story in order: logo, loading 1 to 4 plates, the lift, logo", () => {
    expect(LABELS).toEqual([
      "Sticks and boulders",
      "Deadlift \u00b7 1 plate",
      "Deadlift \u00b7 2 plates",
      "Deadlift \u00b7 3 plates",
      "Deadlift \u00b7 4 plates",
      "Sticks and boulders",
    ]);
  });

  it("keeps the bar on the floor while it is loaded, and lifts it once, at four plates", () => {
    let lifts = 0;
    let up = false;
    for (let ms = 0; ms < TOTAL_MS; ms += 10) {
      const { pose, label } = momentAt(ms);
      const off = pose.form === 1 && pose.barY > PLATE_RADIUS + 0.4;
      if (off) expect(label).toBe("Deadlift \u00b7 4 plates");
      if (off && !up) lifts++;
      up = off;
    }
    expect(lifts).toBe(1);
  });

  it("lands five impacts: the first plates, three plates slammed on, and the set-down", () => {
    expect(IMPACTS.map((i) => i.kind)).toEqual(["floor", "plate", "plate", "plate", "floor"]);
    expect(IMPACTS.filter((i) => i.kind === "plate").map((i) => i.slot)).toEqual([1, 2, 3]);
    // Each plate harder than the last, and the set-down hardest of all.
    const strengths = IMPACTS.map((i) => i.strength);
    expect(strengths[2]).toBeGreaterThan(strengths[1]);
    expect(strengths[3]).toBeGreaterThan(strengths[2]);
    expect(Math.max(...strengths)).toBe(strengths[4]);
  });

  it("shakes and throws chips only just after an impact, and settles", () => {
    for (const hit of IMPACTS) {
      expect(momentAt(hit.at - 30).fx.bursts.some((b) => b.seed === hit.seed)).toBe(false);
      const soon = momentAt(hit.at + 40).fx;
      expect(soon.bursts.some((b) => b.seed === hit.seed)).toBe(true);
      expect(Math.hypot(soon.shakeX, soon.shakeY)).toBeGreaterThan(0);
      const later = momentAt(hit.at + BURST_SECONDS * 1000 + 50).fx;
      expect(later.bursts.some((b) => b.seed === hit.seed)).toBe(false);
    }
  });

  it("keeps the shake small: under 4% of the box at its worst", () => {
    for (let ms = 0; ms < TOTAL_MS; ms += 5) {
      const { fx } = momentAt(ms);
      expect(Math.hypot(fx.shakeX, fx.shakeY)).toBeLessThan(0.04);
    }
  });

  it("never jumps, apart from the bar's flex on an impact", () => {
    let last = momentAt(0).pose;
    for (let ms = 16; ms <= TOTAL_MS; ms += 16) {
      const { pose } = momentAt(ms);
      for (const key of Object.keys(pose) as (keyof typeof pose)[]) {
        if (key === "bend") continue;
        expect(Math.abs(pose[key] - last[key])).toBeLessThan(0.12);
      }
      last = pose;
    }
  });
});
