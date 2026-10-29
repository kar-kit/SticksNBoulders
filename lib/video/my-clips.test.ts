import type { QueuedOp } from "@/lib/offline/queue";
import type { Comment } from "@/lib/review/comments";
import type { ClipSet } from "@/lib/review/queue";
import {
  clipLabel,
  liftOptions,
  mergeClipPages,
  pendingClipIds,
  queuedClipChanges,
  readHistoryView,
  replyParentFor,
  withQueuedClipState,
} from "./my-clips";

let sequence = 0;
const op = (kind: QueuedOp["kind"], payload: Record<string, unknown>, over: Partial<QueuedOp> = {}): QueuedOp => ({
  id: `op-${++sequence}`,
  kind,
  payload,
  sequence,
  attempts: 0,
  nextAttemptAt: 0,
  ...over,
});

const clip = (id: string, over: Partial<ClipSet> = {}): ClipSet => ({
  id,
  athleteId: "joey",
  exerciseId: "squat",
  sessionId: "s1",
  setIndex: 1,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  e1rmKg: 196,
  loggedAt: "2026-10-06T18:00:00.000Z",
  videoFileId: `file-${id}`,
  videoPosterId: null,
  notes: null,
  isWarmup: false,
  ...over,
});

describe("readHistoryView", () => {
  it("reads clips, and anything else as sessions", () => {
    expect(readHistoryView("clips")).toBe("clips");
    expect(readHistoryView(null)).toBe("sessions");
    expect(readHistoryView("videos")).toBe("sessions");
  });
});

describe("withQueuedClipState", () => {
  it("hands back the same list when the queue says nothing about clips", () => {
    const clips = [clip("a")];
    expect(withQueuedClipState(clips, [])).toBe(clips);
    expect(withQueuedClipState(clips, [op("rollup.refresh", { exerciseId: "squat" })])).toBe(clips);
  });

  it("hides a clip deleted with no signal, so it does not come back on a reload", () => {
    const ops = [op("set.attachVideo", { setId: "a", videoFileId: null, videoPosterId: null })];
    expect(withQueuedClipState([clip("a"), clip("b")], ops).map((c) => c.id)).toEqual(["b"]);
  });

  it("hides the clip of a set deleted with no signal", () => {
    expect(withQueuedClipState([clip("a")], [op("set.delete", { setId: "a" })])).toEqual([]);
  });

  it("shows a replacement's file, and its poster only when it is that file's own", () => {
    const [swapped] = withQueuedClipState(
      [clip("a", { videoPosterId: "file-a_poster" })],
      [op("set.attachVideo", { setId: "a", videoFileId: "file-new", videoPosterId: "file-new_poster" })],
    );
    expect(swapped).toMatchObject({ videoFileId: "file-new", videoPosterId: "file-new_poster" });
    const [stale] = withQueuedClipState(
      [clip("a")],
      [op("set.attachVideo", { setId: "a", videoFileId: "file-new", videoPosterId: "file-a_poster" })],
    );
    expect(stale.videoPosterId).toBeNull();
  });

  it("drops the proxy when a replacement is queued, so the new take plays its original (v22)", () => {
    const [swapped] = withQueuedClipState(
      [clip("a", { videoProxyId: "file-a_proxy" })],
      [op("set.attachVideo", { setId: "a", videoFileId: "file-new", videoPosterId: null })],
    );
    expect(swapped).toMatchObject({ videoFileId: "file-new", videoProxyId: null });
  });

  it("takes the latest of several queued changes", () => {
    const ops = [
      op("set.attachVideo", { setId: "a", videoFileId: null }),
      op("set.attachVideo", { setId: "a", videoFileId: "file-again" }),
    ];
    expect(withQueuedClipState([clip("a")], ops)[0].videoFileId).toBe("file-again");
  });

  it("ignores a change that failed for good: the server's copy is what is true", () => {
    const ops = [op("set.attachVideo", { setId: "a", videoFileId: null }, { permanentError: "refused" })];
    expect(withQueuedClipState([clip("a")], ops).map((c) => c.id)).toEqual(["a"]);
  });

  it("lays a note edited offline over the clip, and leaves the note alone for an edit that did not touch it", () => {
    const noted = withQueuedClipState(
      [clip("a", { notes: "old" })],
      [op("set.update", { setId: "a", loadKg: 180, reps: 3, rpe: 8, isWarmup: false, notes: "belt loose" })],
    );
    expect(noted[0].notes).toBe("belt loose");
    const flipped = withQueuedClipState(
      [clip("a", { notes: "old" })],
      [op("set.update", { setId: "a", loadKg: 180, reps: 3, rpe: null, isWarmup: true })],
    );
    expect(flipped[0]).toMatchObject({ notes: "old", isWarmup: true, rpe: null });
  });
});

describe("queuedClipChanges / pendingClipIds", () => {
  it("names the sets with a clip or set change still on the phone", () => {
    const ops = [
      op("set.attachVideo", { setId: "a", videoFileId: null }),
      op("set.update", { setId: "b", loadKg: 1, reps: 1, rpe: null, isWarmup: false }),
      op("clip.delete", { setId: "c", fileId: "f" }),
    ];
    expect([...queuedClipChanges(ops).keys()]).toEqual(["a"]);
    expect([...pendingClipIds(ops)].sort()).toEqual(["a", "b"]);
  });
});

describe("mergeClipPages", () => {
  it("appends a page without repeating a clip already shown", () => {
    expect(mergeClipPages([clip("a"), clip("b")], [clip("b"), clip("c")]).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("liftOptions", () => {
  const names: Record<string, string> = { squat: "Squat", bench: "Bench Press", dead: "Deadlift", pause: "Pause Squat" };
  const nameOf = (id: string) => names[id] ?? id;

  it("offers the filmed lifts, most-filmed first, then by name", () => {
    const options = liftOptions(
      [clip("1"), clip("2"), clip("3", { exerciseId: "dead" }), clip("4", { exerciseId: "bench" })],
      nameOf,
    );
    expect(options.map((o) => o.name)).toEqual(["Squat", "Bench Press", "Deadlift"]);
    expect(options[0].count).toBe(2);
  });

  it("always offers the lift that is selected, even before a page names it", () => {
    expect(liftOptions([clip("1")], nameOf, "pause").map((o) => o.exerciseId)).toEqual(["squat", "pause"]);
  });
});

describe("clipLabel", () => {
  it("says the lift, the numbers in the athlete's unit, the RPE and the day", () => {
    expect(clipLabel(clip("a"), "Squat", "kg")).toMatch(/^Squat, 180 kg × 3 at RPE 8, \d+ Oct$/);
    expect(clipLabel(clip("a", { rpe: null, isWarmup: true, loadKg: 100 }), "Squat", "lb")).toMatch(
      /^Squat, warm-up, 220(\.\d)? lb × 3, \d+ Oct$/,
    );
  });
});

describe("replyParentFor", () => {
  const comment = (id: string, over: Partial<Comment> = {}): Comment => ({
    id,
    setId: "a",
    athleteId: "joey",
    authorId: "ruairi",
    body: "x",
    parentId: null,
    createdAt: "2026-10-06T18:00:00.000Z",
    ...over,
  });

  it("answers the latest thread's opening comment", () => {
    expect(
      replyParentFor([
        comment("c1", { createdAt: "2026-10-06T18:00:00.000Z" }),
        comment("r1", { parentId: "c1", authorId: "joey", createdAt: "2026-10-06T19:00:00.000Z" }),
        comment("c2", { createdAt: "2026-10-07T18:00:00.000Z" }),
      ]),
    ).toBe("c2");
  });

  it("has nothing to answer when nothing was said", () => {
    expect(replyParentFor([])).toBeNull();
  });
});
