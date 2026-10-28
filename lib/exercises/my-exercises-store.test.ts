import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/lib/offline/memory-store";
import { enqueue, queuedOps, resetQueueForTests } from "@/lib/offline/client";
import { newOp, type QueueStore } from "@/lib/offline/queue";
import { checkExerciseDeletable, deleteMyExercise, renameMyExercise, setMyExerciseBodyweight } from "./my-exercises-store";
import type { Exercise } from "./match";

const fetchExerciseUsage = vi.hoisted(() =>
  vi.fn(async () => ({ sets: false, referenceMaxes: false, prescriptions: false })),
);
vi.mock("./usage-store", () => ({ fetchExerciseUsage }));

let store: QueueStore;
const pin: Exercise = { id: "ex-1", name: "Pin Press", normalisedName: "pin press", isGlobal: false, ownerId: "joey" };

beforeEach(() => {
  store = createMemoryStore();
  resetQueueForTests(store);
  fetchExerciseUsage.mockClear();
});

describe("renameMyExercise", () => {
  it("queues the rename", async () => {
    await renameMyExercise("ex-1", "Pin Press (low)");
    expect((await store.all()).map((op) => [op.kind, op.payload])).toEqual([
      ["exercise.rename", { exerciseId: "ex-1", name: "Pin Press (low)" }],
    ]);
  });
});

describe("setMyExerciseBodyweight (F20)", () => {
  it("queues the flag, on and off, as its own op", async () => {
    await setMyExerciseBodyweight("ex-1", true);
    await setMyExerciseBodyweight("ex-1", false);
    expect((await store.all()).map((op) => [op.kind, op.payload])).toEqual([
      ["exercise.bodyweight", { exerciseId: "ex-1", isBodyweight: true }],
      ["exercise.bodyweight", { exerciseId: "ex-1", isBodyweight: false }],
    ]);
  });
});

describe("checkExerciseDeletable", () => {
  it("asks the server about an exercise it already has", async () => {
    expect(await checkExerciseDeletable("joey", pin, [])).toEqual({ ok: true });
    expect(fetchExerciseUsage).toHaveBeenCalledWith("joey", "ex-1");
  });

  it("refuses one with logged sets, saying why", async () => {
    fetchExerciseUsage.mockResolvedValueOnce({ sets: true, referenceMaxes: false, prescriptions: false });
    expect(await checkExerciseDeletable("joey", pin, [])).toEqual({
      ok: false,
      message: "You've logged sets of Pin Press, so it stays. Rename it if the name is wrong.",
    });
  });

  it("needs no read for one that never left the phone, but still sees its queued sets", async () => {
    const create = newOp("exercise.create", { exerciseId: "ex-1", name: "Pin Press" }, 0, "op-0", 0);
    expect(await checkExerciseDeletable("joey", pin, [create])).toEqual({ ok: true });
    const set = newOp("set.create", { setId: "st-1", exerciseId: "ex-1" }, 1, "op-1", 0);
    expect(await checkExerciseDeletable("joey", pin, [create, set])).toMatchObject({ ok: false });
    expect(fetchExerciseUsage).not.toHaveBeenCalled();
  });

  it("says it needs signal rather than guessing", async () => {
    fetchExerciseUsage.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await checkExerciseDeletable("joey", pin, [])).toMatchObject({ ok: false, message: /needs signal/ });
  });
});

describe("deleteMyExercise", () => {
  it("withdraws an exercise whose create never left the phone, with its rename", async () => {
    await enqueue("exercise.create", { exerciseId: "ex-1", name: "pin" });
    await enqueue("exercise.rename", { exerciseId: "ex-1", name: "Pin" });
    expect(await deleteMyExercise("ex-1")).toEqual({ queued: false });
    expect(queuedOps()).toEqual([]);
    expect(await store.all()).toEqual([]);
  });

  it("withdraws a queued bodyweight flag with an exercise that never left the phone", async () => {
    await enqueue("exercise.create", { exerciseId: "ex-1", name: "Ring Dip" });
    await enqueue("exercise.bodyweight", { exerciseId: "ex-1", isBodyweight: true });
    expect(await deleteMyExercise("ex-1")).toEqual({ queued: false });
    expect(await store.all()).toEqual([]);
  });

  it("queues a delete for one Appwrite has", async () => {
    expect(await deleteMyExercise("ex-1")).toEqual({ queued: true });
    expect((await store.all()).map((op) => op.kind)).toEqual(["exercise.delete"]);
  });
});
