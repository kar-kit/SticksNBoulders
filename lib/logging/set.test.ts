import { asksForRpe, canComplete, completionBlocker, countsTowardPrs, RPE_VALUES } from "./set";
import type { LoggableSet } from "./set";

function set(overrides: Partial<LoggableSet> = {}): LoggableSet {
  return { loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false, ...overrides };
}

describe("warm-up exclusion", () => {
  it("counts a completed working set toward PRs", () => {
    expect(countsTowardPrs(set())).toBe(true);
  });

  it("never counts a warm-up, however heavy", () => {
    // A 180kg warm-up single is still a warm-up. If this leaks, the athlete
    // gets a PR they did not hit and the coach's numbers are wrong.
    expect(countsTowardPrs(set({ isWarmup: true, loadKg: 180, reps: 1 }))).toBe(false);
  });

  it("does not count an incomplete set", () => {
    expect(countsTowardPrs(set({ loadKg: null }))).toBe(false);
    expect(countsTowardPrs(set({ reps: null }))).toBe(false);
  });

  it("counts a set with no RPE, because RPE is optional on every set", () => {
    expect(countsTowardPrs(set({ rpe: null }))).toBe(true);
  });
});

describe("RPE", () => {
  it("offers half points from 6 to 10 and nothing else", () => {
    expect(RPE_VALUES).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  });

  it("asks working sets but never warm-ups", () => {
    expect(asksForRpe(set())).toBe(true);
    expect(asksForRpe(set({ isWarmup: true }))).toBe(false);
  });
});

describe("video-required blocking completion", () => {
  it("lets an ordinary set complete", () => {
    expect(canComplete(set())).toBe(true);
    expect(completionBlocker(set())).toBeNull();
  });

  it("blocks a video-required set with no clip and no skip", () => {
    const blocked = set({ videoRequired: true });
    expect(canComplete(blocked)).toBe(false);
    expect(completionBlocker(blocked)).toBe("video-required");
  });

  it("unblocks once a clip is attached", () => {
    expect(canComplete(set({ videoRequired: true, hasVideo: true }))).toBe(true);
  });

  it("unblocks on an explicit skip, which is recorded", () => {
    // "Skip, no video" is a decision the coach can see, not a silent bypass.
    expect(canComplete(set({ videoRequired: true, videoSkipped: true }))).toBe(true);
  });

  it("reports incompleteness ahead of the video block", () => {
    // Nothing to film yet if the numbers are not in.
    const empty = set({ loadKg: null, reps: null, videoRequired: true });
    expect(completionBlocker(empty)).toBe("incomplete");
  });

  it("still blocks a video-required set that is otherwise valid", () => {
    const withRpe = set({ videoRequired: true, rpe: 9 });
    expect(canComplete(withRpe)).toBe(false);
  });
});

describe("completion validity", () => {
  it.each([
    ["zero load", { loadKg: 0 }],
    ["negative load", { loadKg: -100 }],
    ["zero reps", { reps: 0 }],
    ["fractional reps", { reps: 2.5 }],
    ["missing load", { loadKg: null }],
    ["missing reps", { reps: null }],
  ])("refuses to complete a set with %s", (_label, overrides) => {
    expect(canComplete(set(overrides))).toBe(false);
  });
});
