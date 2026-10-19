import { describe, expect, it } from "vitest";
import { BLOCK_COACH_COMMENTED, blockRemovalLabel, planBlockRemoval } from "./block-removal";

const set = (clientSetId: string, exerciseId: string, isWarmup = false) => ({ clientSetId, exerciseId, isWarmup });
const session = [set("w", "squat", true), set("a", "squat"), set("b", "bench"), set("c", "squat")];

describe("planBlockRemoval", () => {
  it("takes every set of that exercise, warm-ups included, and nothing else", () => {
    const plan = planBlockRemoval("squat", session, new Set(), "b");
    expect(plan).toEqual({ kind: "ok", sets: [session[0], session[1], session[3]], clearsRest: false });
  });

  it("clears the rest only when the session's latest set is in the block", () => {
    const plan = planBlockRemoval("squat", session, new Set(), "c");
    expect(plan.kind === "ok" && plan.clearsRest).toBe(true);
  });

  it("removes an exercise with nothing logged, touching no rest", () => {
    expect(planBlockRemoval("deadlift", session, new Set(), "c")).toEqual({ kind: "ok", sets: [], clearsRest: false });
  });

  it("refuses when the coach has commented on any of its sets", () => {
    expect(planBlockRemoval("squat", session, new Set(["a"]), "c")).toEqual({
      kind: "blocked",
      reason: BLOCK_COACH_COMMENTED,
    });
  });

  it("is not blocked by a comment on another exercise", () => {
    expect(planBlockRemoval("squat", session, new Set(["b"]), null).kind).toBe("ok");
  });
});

describe("blockRemovalLabel", () => {
  it("says how many sets went with it", () => {
    expect(blockRemovalLabel("Squat", [])).toBe("Squat removed");
    expect(blockRemovalLabel("Squat", [set("a", "squat")])).toBe("Squat removed · 1 set deleted");
    expect(blockRemovalLabel("Squat", [set("a", "squat"), set("b", "squat")])).toBe("Squat removed · 2 sets deleted");
  });
});
