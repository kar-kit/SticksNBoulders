import { BURST_SECONDS, FINAL_LABEL, FINAL_POSE, NO_FX, PLATE_RADIUS } from "./hero-mode";
import { IMPACTS, LABELS, momentAt, TOTAL_MS } from "./hero-timeline";

describe("momentAt", () => {
  it("starts and ends on the poster, the logo, with nothing shaking", () => {
    for (const ms of [0, TOTAL_MS, TOTAL_MS * 3]) {
      expect(momentAt(ms)).toEqual({ pose: FINAL_POSE, label: FINAL_LABEL, fx: NO_FX });
    }
  });

  it("runs in competition order, loading each bar up from one plate: squat, bench, deadlift", () => {
    expect(LABELS).toEqual([
      "Sticks and boulders",
      "Squat \u00b7 1 plate",
      "Squat \u00b7 2 plates",
      "Squat \u00b7 3 plates",
      "Bench \u00b7 1 plate",
      "Bench \u00b7 2 plates",
      "Deadlift \u00b7 1 plate",
      "Deadlift \u00b7 2 plates",
      "Deadlift \u00b7 3 plates",
      "Deadlift \u00b7 4 plates",
      "Sticks and boulders",
    ]);
  });

  /** How many times the bar dips below `depth` while `label` is showing. */
  const reps = (label: string, below: (barY: number) => boolean) => {
    let count = 0;
    let inRep = false;
    for (let ms = 0; ms < TOTAL_MS; ms += 10) {
      const { pose, label: shown } = momentAt(ms);
      const now = shown === label && below(pose.barY);
      if (now && !inRep) count++;
      inRep = now;
    }
    return count;
  };

  it("does one rep of each lift, on the full bar", () => {
    expect(reps("Squat \u00b7 3 plates", (y) => y < 1.2)).toBe(1);
    expect(reps("Bench \u00b7 2 plates", (y) => y < 0.95)).toBe(1);
    expect(reps("Deadlift \u00b7 4 plates", (y) => y > PLATE_RADIUS + 0.4)).toBe(1);
  });

  it("never moves the bar while it is being loaded or stripped", () => {
    for (let ms = 0; ms < TOTAL_MS; ms += 10) {
      const { pose } = momentAt(ms);
      const between = Math.abs(pose.plates - Math.round(pose.plates)) > 0.02;
      if (between && pose.form === 1) {
        const later = momentAt(ms + 10).pose;
        expect(Math.abs(later.barY - pose.barY)).toBeLessThan(1e-9);
      }
    }
  });

  it("keeps the bar stiff: it bends a little under load, never a lot", () => {
    let most = 0;
    for (let ms = 0; ms < TOTAL_MS; ms += 5) most = Math.max(most, Math.abs(momentAt(ms).pose.bend));
    expect(most).toBeGreaterThan(0.01);
    expect(most).toBeLessThan(0.08);
  });

  it("lands every impact in order: plates slammed on, bars set down, bars racked", () => {
    expect(IMPACTS.map((i) => i.kind)).toEqual([
      "floor", "hook", "plate", "plate", "hook",
      "plate", "hook",
      "floor", "plate", "plate", "plate", "floor",
    ]);
    const plates = IMPACTS.filter((i) => i.kind === "plate");
    expect(plates.map((i) => i.slot)).toEqual([1, 2, 1, 1, 2, 3]);
    // The set-down after the deadlift is the hardest hit of all.
    const strengths = IMPACTS.map((i) => i.strength);
    expect(Math.max(...strengths)).toBe(strengths[strengths.length - 1]);
  });

  it("clanks on the hooks with a shake but no chips", () => {
    for (const hit of IMPACTS.filter((i) => i.kind === "hook")) {
      const { fx } = momentAt(hit.at + 40);
      expect(Math.hypot(fx.shakeX, fx.shakeY)).toBeGreaterThan(0);
      expect(fx.bursts.some((b) => b.seed === hit.seed)).toBe(false);
    }
  });

  it("shakes and throws chips only just after an impact, and settles", () => {
    for (const hit of IMPACTS.filter((i) => i.kind !== "hook")) {
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
