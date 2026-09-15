import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_BYTES,
  VIDEO_EXTENSIONS,
  canAttachClip,
  checkClip,
  extensionOf,
  isReplacement,
  setForNewClip,
  type AttachableSet,
} from "./clip";

const SQUAT = "ex-squat";
const BENCH = "ex-bench";

const set = (over: Partial<AttachableSet> & { clientSetId: string }): AttachableSet => ({
  exerciseId: SQUAT,
  loggedAt: new Date("2026-09-15T10:00:00.000Z"),
  ...over,
});

describe("what can be attached", () => {
  it("takes what a phone camera produces", () => {
    for (const extension of VIDEO_EXTENSIONS) {
      expect(checkClip({ name: `clip.${extension}`, size: 5_000_000 })).toEqual({ ok: true });
    }
  });

  it("is case insensitive about the extension, because iOS is not", () => {
    expect(checkClip({ name: "IMG_4021.MOV", size: 5_000_000 })).toEqual({ ok: true });
  });

  it("refuses anything that is not a video, and says what to do", () => {
    const result = checkClip({ name: "program.pdf", size: 1000 });
    expect(result).toMatchObject({ ok: false, reason: "type" });
    expect((result as { message: string }).message).toContain("mp4");
  });

  it("refuses a file with no extension at all", () => {
    expect(checkClip({ name: "clip", size: 1000 })).toMatchObject({ reason: "type" });
  });

  it("refuses an empty file rather than uploading nothing", () => {
    expect(checkClip({ name: "clip.mp4", size: 0 })).toMatchObject({ reason: "empty" });
  });

  /**
   * The instance caps files at 30,000,000 bytes and storage rejects anything
   * larger outright, so this has to be caught here -- an athlete on gym wifi
   * must not wait two minutes to be told no.
   */
  it("refuses a clip the instance would reject, before the upload starts", () => {
    const result = checkClip({ name: "clip.mov", size: MAX_VIDEO_BYTES + 1 });
    expect(result).toMatchObject({ ok: false, reason: "too-big" });
    // Derived rather than hardcoded: the limit tracks the instance and moved
    // once already, and a test pinning the old number just breaks on the day
    // somebody fixes the thing it was measuring.
    const message = (result as { message: string }).message;
    expect(message).toContain(`${MAX_VIDEO_BYTES / 1_000_000}MB`);
    // The message has to be actionable on a gym floor, not a status code.
    expect(message).toMatch(/shorter|trim/);
  });

  it("allows a clip exactly at the limit", () => {
    expect(checkClip({ name: "clip.mp4", size: MAX_VIDEO_BYTES })).toEqual({ ok: true });
  });

  it("reads an extension off a name with dots in it", () => {
    expect(extensionOf("squat.2026.09.15.mp4")).toBe("mp4");
    expect(extensionOf("noextension")).toBe("");
  });
});

describe("which set a clip attaches to", () => {
  /**
   * The Set Row spec: one camera per exercise, not one per row, attaching to
   * the most recently logged set of that exercise. A per-row camera bought
   * nothing and cost the confirm target its column.
   */
  it("takes the most recently logged set of that exercise", () => {
    const sets = [
      set({ clientSetId: "a", loggedAt: new Date("2026-09-15T10:00:00.000Z") }),
      set({ clientSetId: "b", loggedAt: new Date("2026-09-15T10:05:00.000Z") }),
      set({ clientSetId: "c", loggedAt: new Date("2026-09-15T10:02:00.000Z") }),
    ];
    expect(setForNewClip(sets, SQUAT)?.clientSetId).toBe("b");
  });

  it("does not cross exercises", () => {
    const sets = [
      set({ clientSetId: "squat", loggedAt: new Date("2026-09-15T10:00:00.000Z") }),
      set({
        clientSetId: "bench",
        exerciseId: BENCH,
        loggedAt: new Date("2026-09-15T10:30:00.000Z"),
      }),
    ];
    expect(setForNewClip(sets, SQUAT)?.clientSetId).toBe("squat");
    expect(setForNewClip(sets, BENCH)?.clientSetId).toBe("bench");
  });

  /**
   * A coach asking to see a warm-up is asking about setup, which is a real
   * coaching question. The warm-up rule is about numbers, not about video.
   */
  it("will attach to a warm-up", () => {
    // Choosing a target does not consider the warm-up flag at all, which is
    // the point: a coach asking to see a warm-up is asking about setup.
    const sets = [set({ clientSetId: "w" })];
    expect(setForNewClip(sets, SQUAT)?.clientSetId).toBe("w");
  });

  it("has nowhere to put a clip before anything is logged", () => {
    expect(setForNewClip([], SQUAT)).toBeNull();
    expect(setForNewClip([set({ clientSetId: "b", exerciseId: BENCH })], SQUAT)).toBeNull();
  });

  it("skips a set with an unreadable timestamp rather than picking it", () => {
    const sets = [
      set({ clientSetId: "good" }),
      set({ clientSetId: "broken", loggedAt: new Date("nonsense") }),
    ];
    expect(setForNewClip(sets, SQUAT)?.clientSetId).toBe("good");
  });

  /** Offered only when there is something to attach to -- absent, not disabled. */
  it("only offers the camera when a set exists to attach to", () => {
    expect(canAttachClip([], SQUAT)).toBe(false);
    expect(canAttachClip([set({ clientSetId: "a" })], SQUAT)).toBe(true);
  });
});

describe("replacing a clip", () => {
  it("knows when attaching would overwrite one", () => {
    expect(isReplacement({ hasVideo: true })).toBe(true);
    expect(isReplacement({ hasVideo: false })).toBe(false);
    expect(isReplacement({})).toBe(false);
  });
});
