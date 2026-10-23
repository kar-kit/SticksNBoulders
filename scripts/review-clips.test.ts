import { applyReviewClips, planReviewClips, type ReviewClipsDeps, type Row } from "./review-clips";

const review = (id: string, setId: string, createdAt: string, over: Partial<Row> = {}): Row => ({
  $id: id,
  $createdAt: createdAt,
  set_id: setId,
  coach_id: "ruairi",
  athlete_id: "joey",
  video_file_id: null,
  ...over,
});

function world() {
  const reviews = new Map<string, Row>();
  const sets = new Map<string, Row>();
  const files = new Map<string, string>();
  const log: string[] = [];
  const stamp = vi.fn<ReviewClipsDeps["stamp"]>(async () => {});
  const requeue = vi.fn<ReviewClipsDeps["requeue"]>(async () => {});
  const deps: ReviewClipsDeps = {
    legacyReviews: async () => [...reviews.values()],
    getReview: async (id) => reviews.get(id) ?? null,
    getSet: async (id) => sets.get(id) ?? null,
    clipCreatedAt: async (id) => files.get(id) ?? null,
    stamp,
    requeue,
    log: (line) => log.push(line),
  };
  return { reviews, sets, files, deps, stamp, requeue, log };
}

describe("planReviewClips", () => {
  it("stamps a review with the clip the coach watched, and re-queues one whose clip was replaced since", async () => {
    const w = world();
    w.sets.set("s1", { $id: "s1", athlete_id: "joey", video_file_id: "take-1" });
    w.files.set("take-1", "2026-10-01T10:00:00.000Z");
    w.reviews.set("r1", review("r1", "s1", "2026-10-02T10:00:00.000Z"));

    w.sets.set("s2", { $id: "s2", athlete_id: "joey", video_file_id: "take-2" });
    // Uploaded after the review: a replacement the coach has not seen.
    w.files.set("take-2", "2026-10-05T10:00:00.000Z");
    w.reviews.set("r2", review("r2", "s2", "2026-10-02T10:00:00.000Z"));

    const plan = await planReviewClips(w.deps);
    expect(plan.map((e) => [e.rowId, e.kind, e.videoFileId])).toEqual([
      ["r1", "stamp", "take-1"],
      ["r2", "requeue", "take-2"],
    ]);
  });

  it("leaves alone what it cannot decide, and reads only", async () => {
    const w = world();
    w.reviews.set("gone", review("gone", "nope", "2026-10-02T10:00:00.000Z"));
    w.sets.set("bare", { $id: "bare", athlete_id: "joey", video_file_id: null });
    w.reviews.set("bare", review("bare", "bare", "2026-10-02T10:00:00.000Z"));
    w.sets.set("nofile", { $id: "nofile", athlete_id: "joey", video_file_id: "lost" });
    w.reviews.set("nofile", review("nofile", "nofile", "2026-10-02T10:00:00.000Z"));
    w.sets.set("theirs", { $id: "theirs", athlete_id: "sam", video_file_id: "x" });
    w.reviews.set("theirs", review("theirs", "theirs", "2026-10-02T10:00:00.000Z"));
    // Already stamped: not legacy at all.
    w.reviews.set("done", review("done", "bare", "2026-10-02T10:00:00.000Z", { video_file_id: "take-9" }));

    const plan = await planReviewClips(w.deps);
    expect(plan.map((e) => [e.rowId, e.kind, e.reason])).toEqual([
      ["gone", "skip", "set is gone"],
      ["bare", "skip", "set has no clip"],
      ["nofile", "skip", "clip file not found"],
      ["theirs", "skip", "set belongs to someone else"],
    ]);
    expect(w.stamp).not.toHaveBeenCalled();
    expect(w.requeue).not.toHaveBeenCalled();
  });
});

describe("applyReviewClips", () => {
  it("stamps and re-queues as planned", async () => {
    const w = world();
    w.sets.set("s1", { $id: "s1", athlete_id: "joey", video_file_id: "take-1" });
    w.files.set("take-1", "2026-10-01T10:00:00.000Z");
    w.reviews.set("r1", review("r1", "s1", "2026-10-02T10:00:00.000Z"));
    w.sets.set("s2", { $id: "s2", athlete_id: "joey", video_file_id: "take-2" });
    w.files.set("take-2", "2026-10-05T10:00:00.000Z");
    w.reviews.set("r2", review("r2", "s2", "2026-10-02T10:00:00.000Z"));

    const result = await applyReviewClips(await planReviewClips(w.deps), w.deps);
    expect(result).toEqual({ stamped: 1, requeued: 1, changed: 0, failed: 0 });
    expect(w.stamp).toHaveBeenCalledWith({ rowId: "r1", athleteId: "joey", coachId: "ruairi", videoFileId: "take-1" });
    expect(w.requeue).toHaveBeenCalledWith("r2");
  });

  it("skips a review the coach re-cleared, or a clip replaced again, since the plan", async () => {
    const w = world();
    w.sets.set("s1", { $id: "s1", athlete_id: "joey", video_file_id: "take-1" });
    w.files.set("take-1", "2026-10-01T10:00:00.000Z");
    w.reviews.set("r1", review("r1", "s1", "2026-10-02T10:00:00.000Z"));
    w.sets.set("s2", { $id: "s2", athlete_id: "joey", video_file_id: "take-2" });
    w.files.set("take-2", "2026-10-01T10:00:00.000Z");
    w.reviews.set("r2", review("r2", "s2", "2026-10-02T10:00:00.000Z"));
    const plan = await planReviewClips(w.deps);

    w.reviews.set("r1", { ...w.reviews.get("r1")!, video_file_id: "take-1" });
    w.sets.set("s2", { ...w.sets.get("s2")!, video_file_id: "take-3" });

    const result = await applyReviewClips(plan, w.deps);
    expect(result).toEqual({ stamped: 0, requeued: 0, changed: 2, failed: 0 });
    expect(w.stamp).not.toHaveBeenCalled();
  });

  it("logs one failure and carries on", async () => {
    const w = world();
    for (const id of ["a", "b"]) {
      w.sets.set(id, { $id: id, athlete_id: "joey", video_file_id: `f-${id}` });
      w.files.set(`f-${id}`, "2026-10-01T10:00:00.000Z");
      w.reviews.set(`r-${id}`, review(`r-${id}`, id, "2026-10-02T10:00:00.000Z"));
    }
    w.stamp.mockRejectedValueOnce(new Error("boom"));
    const result = await applyReviewClips(await planReviewClips(w.deps), w.deps);
    expect(result).toEqual({ stamped: 1, requeued: 0, changed: 0, failed: 1 });
    expect(w.log.join("\n")).toContain("boom");
  });
});
