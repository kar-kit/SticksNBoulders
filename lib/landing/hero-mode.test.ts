import { chooseHero, SAMPLE_FRAMES, tooSlow, type HeroEnvironment } from "./hero-mode";

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
