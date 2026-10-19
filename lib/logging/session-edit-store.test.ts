import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/lib/offline/memory-store";
import { enqueue, resetQueueForTests } from "@/lib/offline/client";
import { newOp, type QueueStore, type QueuedOp } from "@/lib/offline/queue";
import { checkSessionDeletable, deleteSessionAndSets, reviseSession, reviseSessionTotals } from "./session-edit-store";

// No actor is attached, so the queue writes down and never drains. What is on
// disk afterwards is the assertion.
vi.mock("@/lib/video/pending-store", () => ({ forgetUpload: vi.fn(async () => {}), pendingUploads: vi.fn(async () => []) }));
const fetchCommentsForSets = vi.hoisted(() => vi.fn<(ids: readonly string[]) => Promise<{ authorId: string }[]>>());
vi.mock("@/lib/review/comment-store", () => ({ fetchCommentsForSets }));

let store: QueueStore;
const LOGGED = new Date("2026-09-14T09:30:00.000Z");
const NEXT_WEEK = new Date("2026-09-22T09:30:00.000Z");

const onDisk = async () =>
  (await store.all())
    .sort((a, b) => a.sequence - b.sequence)
    .map((op: QueuedOp) => [op.kind, op.payload.setId ?? op.payload.sessionId ?? op.payload.exerciseId]);

/** A create from an earlier visit that was tried, so the row may be on the server. */
async function landed(kind: QueuedOp["kind"], payload: Record<string, unknown>) {
  await store.put({ ...newOp(kind, payload, 0, "op-earlier", 0), attempts: 1 });
}

beforeEach(() => {
  store = createMemoryStore();
  resetQueueForTests(store);
  fetchCommentsForSets.mockReset().mockResolvedValue([]);
});

describe("reviseSession", () => {
  it("queues only the fields given", async () => {
    await reviseSession("cs-1", { name: "Heavy" });
    await reviseSessionTotals("cs-1", { setCount: 3, tonnageKg: 900 });
    const payloads = (await store.all()).sort((a, b) => a.sequence - b.sequence).map((op) => op.payload);
    expect(payloads).toEqual([
      { sessionId: "cs-1", name: "Heavy" },
      { sessionId: "cs-1", setCount: 3, tonnageKg: 900 },
    ]);
  });
});

describe("deleteSessionAndSets", () => {
  it("deletes each landed set with its rollup and clip, then the session last", async () => {
    await deleteSessionAndSets("cs-1", [
      { clientSetId: "st-1", exerciseId: "squat", loggedAt: LOGGED, videoFileId: "vid-1" },
      { clientSetId: "st-2", exerciseId: "squat", loggedAt: LOGGED },
      { clientSetId: "st-3", exerciseId: "bench", loggedAt: NEXT_WEEK },
    ]);
    expect(await onDisk()).toEqual([
      ["set.delete", "st-1"],
      ["rollup.refresh", "squat"],
      ["clip.delete", "st-1"],
      ["set.delete", "st-2"],
      ["rollup.refresh", "squat"],
      ["set.delete", "st-3"],
      ["rollup.refresh", "bench"],
      ["session.delete", "cs-1"],
    ]);
    // Every (exercise, week) the session touched is refreshed; the queue
    // collapses the two squat refreshes to the last when it drains.
    const weeks = (await store.all())
      .filter((op) => op.kind === "rollup.refresh")
      .map((op) => `${op.payload.exerciseId}@${op.payload.weekKey}`);
    expect(new Set(weeks).size).toBe(2);
  });

  it("withdraws a session that never left the phone, sending nothing", async () => {
    await enqueue("session.create", { sessionId: "cs-1", startedAt: LOGGED.toISOString() });
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1", exerciseId: "squat" });
    const result = await deleteSessionAndSets("cs-1", [{ clientSetId: "st-1", exerciseId: "squat", loggedAt: LOGGED }]);
    expect(result).toEqual({ queued: false });
    expect(await onDisk()).toEqual([]);
  });

  it("queues a real delete for a session whose create may have landed", async () => {
    await landed("session.create", { sessionId: "cs-1", startedAt: LOGGED.toISOString() });
    const result = await deleteSessionAndSets("cs-1", []);
    expect(result).toEqual({ queued: true });
    expect(await onDisk()).toEqual([
      ["session.create", "cs-1"],
      ["session.delete", "cs-1"],
    ]);
  });
});

describe("checkSessionDeletable", () => {
  it("needs no read for a session none of whose sets reached Appwrite", async () => {
    expect(await checkSessionDeletable("joey", [])).toEqual({ ok: true });
    expect(fetchCommentsForSets).not.toHaveBeenCalled();
  });

  it("refuses when the coach has commented on any set", async () => {
    fetchCommentsForSets.mockResolvedValue([{ authorId: "ruairi" }]);
    expect(await checkSessionDeletable("joey", ["st-1", "st-2"])).toMatchObject({ ok: false, reason: "coach-feedback" });
    expect(fetchCommentsForSets).toHaveBeenCalledWith(["st-1", "st-2"]);
  });

  it("allows it when the only comments are the athlete's", async () => {
    fetchCommentsForSets.mockResolvedValue([{ authorId: "joey" }]);
    expect(await checkSessionDeletable("joey", ["st-1"])).toEqual({ ok: true });
  });

  it("says it needs signal rather than guessing", async () => {
    fetchCommentsForSets.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await checkSessionDeletable("joey", ["st-1"])).toMatchObject({ ok: false, reason: "offline" });
  });
});
