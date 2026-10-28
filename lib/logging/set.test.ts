import {
  asksForRpe,
  canComplete,
  completionBlocker,
  countsTowardPrs,
  isLoggedRpe,
  isPrescribableRpe,
  LOGGED_RPE_VALUES,
  PRESCRIBABLE_RPE_VALUES,
  UNDER_SIX_RPE_VALUES,
} from "./set";
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
  it("lets a coach prescribe half points from 6 to 10 and nothing else", () => {
    expect(PRESCRIBABLE_RPE_VALUES).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  });

  it("lets an athlete log 5, 4 and 3 on top of that, for sets too easy to call 6", () => {
    expect(UNDER_SIX_RPE_VALUES).toEqual([5, 4, 3]);
    expect(LOGGED_RPE_VALUES).toEqual([3, 4, 5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  });

  it("keeps sub-6 off the prescribable scale while it is loggable", () => {
    for (const rpe of [3, 4, 5]) {
      expect(isLoggedRpe(rpe)).toBe(true);
      expect(isPrescribableRpe(rpe)).toBe(false);
    }
    expect(isPrescribableRpe(6)).toBe(true);
    // No half points below 6, and nothing outside the scale either way.
    for (const rpe of [2, 4.5, 5.5, 10.5, 11, Number.NaN]) expect(isLoggedRpe(rpe)).toBe(false);
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

describe("a failed set (F19)", () => {
  it("can be logged with 0 reps, which a made set cannot", () => {
    expect(canComplete(set({ reps: 0 }))).toBe(false);
    expect(canComplete(set({ reps: 0, failed: true }))).toBe(true);
    expect(completionBlocker(set({ reps: 0, failed: true }))).toBeNull();
  });

  it("still needs a load and a whole, non-negative rep count", () => {
    expect(canComplete(set({ reps: -1, failed: true }))).toBe(false);
    expect(canComplete(set({ reps: null, failed: true }))).toBe(false);
    expect(canComplete(set({ loadKg: 0, reps: 0, failed: true }))).toBe(false);
  });

  it("never counts toward a PR, whatever it shows", () => {
    expect(countsTowardPrs(set({ reps: 3 }))).toBe(true);
    expect(countsTowardPrs(set({ reps: 3, failed: true }))).toBe(false);
  });
});

describe("a bodyweight exercise (F20)", () => {
  it("logs at 0 kg, which any other lift refuses", () => {
    expect(canComplete(set({ loadKg: 0, reps: 12, isBodyweight: true }))).toBe(true);
    expect(completionBlocker(set({ loadKg: 0, reps: 12, isBodyweight: true }))).toBeNull();
    expect(canComplete(set({ loadKg: 0, reps: 12 }))).toBe(false);
    expect(canComplete(set({ loadKg: 0, reps: 12, isBodyweight: false }))).toBe(false);
    // Null is what a set built from a library cached before v20 carries.
    expect(canComplete(set({ loadKg: 0, reps: 12, isBodyweight: null }))).toBe(false);
  });

  it("says why a 0 kg set on any other lift will not log, ahead of everything else", () => {
    expect(completionBlocker(set({ loadKg: 0, reps: 12 }))).toBe("zero-load");
    expect(completionBlocker(set({ loadKg: 0, reps: null }))).toBe("zero-load");
    expect(completionBlocker(set({ loadKg: 0, reps: 5, videoRequired: true }))).toBe("zero-load");
    // An empty load is not a 0: that is just a row not filled in yet.
    expect(completionBlocker(set({ loadKg: null, reps: 12 }))).toBe("incomplete");
  });

  it("keeps added load working as before: a +20 kg pull-up logs, flagged or not", () => {
    expect(canComplete(set({ loadKg: 20, reps: 5, isBodyweight: true }))).toBe(true);
    expect(canComplete(set({ loadKg: 20, reps: 5 }))).toBe(true);
  });

  it("still needs reps, and refuses a load below zero or not a number", () => {
    expect(canComplete(set({ loadKg: 0, reps: 0, isBodyweight: true }))).toBe(false);
    expect(canComplete(set({ loadKg: 0, reps: null, isBodyweight: true }))).toBe(false);
    expect(canComplete(set({ loadKg: -5, reps: 10, isBodyweight: true }))).toBe(false);
    expect(canComplete(set({ loadKg: Number.NaN, reps: 10, isBodyweight: true }))).toBe(false);
  });

  it("lets a missed rep at bodyweight be logged as failed, 0 x 0", () => {
    expect(canComplete(set({ loadKg: 0, reps: 0, failed: true, isBodyweight: true }))).toBe(true);
    expect(canComplete(set({ loadKg: 0, reps: 0, failed: true }))).toBe(false);
  });

  it("counts toward PRs as a working set, and as a warm-up does not", () => {
    expect(countsTowardPrs(set({ loadKg: 0, reps: 12, isBodyweight: true }))).toBe(true);
    expect(countsTowardPrs(set({ loadKg: 0, reps: 12, isBodyweight: true, isWarmup: true }))).toBe(false);
    expect(countsTowardPrs(set({ loadKg: 0, reps: 12 }))).toBe(false);
  });

  it("is still gated by the coach's video ask like any set", () => {
    expect(completionBlocker(set({ loadKg: 0, reps: 12, isBodyweight: true, videoRequired: true }))).toBe(
      "video-required",
    );
  });
});
