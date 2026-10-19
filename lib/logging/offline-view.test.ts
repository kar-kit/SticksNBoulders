import { describe, expect, it } from "vitest";
import { newOp, type QueuedOp } from "@/lib/offline/queue";
import {
  applyQueuedSessionEdits,
  lostOps,
  mergeById,
  queuedSessions,
  queuedSets,
  refusedDeletes,
  refusedRowDeletes,
  unsyncedIds,
} from "./offline-view";
import { EXERCISE_IN_USE, SESSION_HAS_SETS } from "@/appwrite/documents/write";
import type { SessionRecord } from "./session";

let sequence = 0;
const op = (kind: QueuedOp["kind"], payload: Record<string, unknown>): QueuedOp =>
  newOp(kind, payload, sequence, `op-${sequence++}`, 0);

const STARTED = "2026-09-14T09:00:00.000Z";

describe("queuedSessions", () => {
  it("shows a session started with no signal as a running session", () => {
    const [session] = queuedSessions([op("session.create", { sessionId: "cs-1", startedAt: STARTED })]);
    expect(session).toMatchObject({ id: "cs-1", clientSessionId: "cs-1", finishedAt: null });
    expect(session.startedAt.toISOString()).toBe(STARTED);
  });

  it("applies a finish that has not synced either", () => {
    const finishedAt = "2026-09-14T10:30:00.000Z";
    const [session] = queuedSessions([
      op("session.create", { sessionId: "cs-1", startedAt: STARTED }),
      op("session.finish", { sessionId: "cs-1", finishedAt, setCount: 12, tonnageKg: 8400 }),
    ]);
    expect(session.finishedAt?.toISOString()).toBe(finishedAt);
    expect(session.setCount).toBe(12);
  });

  it("ignores an op that can never send, so nothing claims to be running", () => {
    const dead = { ...op("session.create", { sessionId: "cs-1", startedAt: STARTED }), permanentError: "rejected" };
    expect(queuedSessions([dead])).toEqual([]);
  });
});

describe("queuedSets", () => {
  const created = (setId: string, sessionId = "cs-1") =>
    op("set.create", {
      setId,
      sessionId,
      exerciseId: "ex-1",
      loadKg: 100,
      reps: 5,
      rpe: 8,
      isWarmup: false,
      loggedAt: STARTED,
    });

  it("returns the sets of that session only", () => {
    const sets = queuedSets([created("st-1"), created("st-2", "cs-other")], "cs-1");
    expect(sets.map((s) => s.clientSetId)).toEqual(["st-1"]);
    expect(sets[0]).toMatchObject({ loadKg: 100, reps: 5, rpe: 8, isWarmup: false });
  });

  it("drops one that has been undone while still queued", () => {
    const sets = queuedSets([created("st-1"), op("set.delete", { setId: "st-1" })], "cs-1");
    expect(sets).toEqual([]);
  });
});

describe("mergeById", () => {
  const session = (id: string): SessionRecord => ({
    id,
    clientSessionId: id,
    startedAt: new Date(STARTED),
    finishedAt: null,
    setCount: 0,
    tonnageKg: 0,
    notes: null,
  });

  it("prefers the server's copy of a row it already has", () => {
    // A queued op that has already landed would otherwise show up twice: once
    // as the real row and once as the copy still waiting to be removed.
    const merged = mergeById([session("cs-1")], [session("cs-1"), session("cs-2")], (s) => s.id);
    expect(merged.map((s) => s.id)).toEqual(["cs-1", "cs-2"]);
  });
});

describe("unsyncedIds", () => {
  it("names the rows that should carry a pending mark", () => {
    expect([...unsyncedIds([op("set.create", { setId: "st-7", sessionId: "cs-1" })])]).toEqual(["st-7"]);
  });
});

describe("refused deletes", () => {
  const failedDelete = (id: string, setId: string, permanentError: string): QueuedOp => ({
    id,
    kind: "set.delete",
    payload: { setId },
    sequence: 1,
    attempts: 1,
    nextAttemptAt: 0,
    permanentError,
  });

  it("picks out deletes refused because a coach commented, by set", () => {
    const ops = [failedDelete("op-1", "st-a", "set-has-coach-comments"), failedDelete("op-2", "st-b", "rejected")];
    expect([...refusedDeletes(ops)]).toEqual([["st-a", "op-1"]]);
  });

  it("does not count them as lost work", () => {
    const ops = [failedDelete("op-1", "st-a", "set-has-coach-comments"), failedDelete("op-2", "st-b", "rejected")];
    expect(lostOps(ops).map((op) => op.id)).toEqual(["op-2"]);
  });
});

describe("applyQueuedSessionEdits", () => {
  const server: SessionRecord = {
    id: "s1",
    clientSessionId: "s1",
    startedAt: new Date(STARTED),
    finishedAt: new Date("2026-09-14T10:00:00.000Z"),
    setCount: 10,
    tonnageKg: 5000,
    notes: "old",
    name: null,
  };

  it("shows a rename made with no signal as done", () => {
    const [session] = applyQueuedSessionEdits([server], [op("session.update", { sessionId: "s1", name: "Heavy" })]);
    expect(session).toMatchObject({ name: "Heavy", notes: "old", setCount: 10 });
  });

  it("applies restated totals without touching the name", () => {
    const [session] = applyQueuedSessionEdits(
      [{ ...server, name: "Kept" }],
      [op("session.update", { sessionId: "s1", setCount: 9, tonnageKg: 4550 })],
    );
    expect(session).toMatchObject({ name: "Kept", setCount: 9, tonnageKg: 4550 });
  });

  it("applies edits in the order they were made", () => {
    const [session] = applyQueuedSessionEdits(
      [server],
      [op("session.update", { sessionId: "s1", name: "First" }), op("session.update", { sessionId: "s1", name: null })],
    );
    expect(session.name).toBeNull();
  });

  it("hides a session whose delete is still queued", () => {
    expect(applyQueuedSessionEdits([server], [op("session.delete", { sessionId: "s1" })])).toEqual([]);
  });

  it("brings a session back once its delete was refused", () => {
    const refused = { ...op("session.delete", { sessionId: "s1" }), permanentError: SESSION_HAS_SETS };
    expect(applyQueuedSessionEdits([server], [refused])).toHaveLength(1);
  });

  it("applies to a session still in the queue as well", () => {
    const [session] = queuedSessions([
      op("session.create", { sessionId: "cs-9", startedAt: STARTED }),
      op("session.update", { sessionId: "cs-9", name: "Basement day" }),
    ]);
    expect(session.name).toBe("Basement day");
  });
});

describe("refused row deletes", () => {
  it("keys a refused session or exercise delete by its row, and keeps them out of the lost list", () => {
    const session = { ...op("session.delete", { sessionId: "s1" }), permanentError: SESSION_HAS_SETS };
    const exercise = { ...op("exercise.delete", { exerciseId: "ex-1" }), permanentError: EXERCISE_IN_USE };
    expect(refusedRowDeletes([session, exercise], "session")).toEqual(new Map([["s1", session.id]]));
    expect(refusedRowDeletes([session, exercise], "exercise")).toEqual(new Map([["ex-1", exercise.id]]));
    expect(lostOps([session, exercise])).toEqual([]);
  });

  it("does not hide a clip delete that failed, nor count it as lost training", () => {
    const clip = { ...op("clip.delete", { setId: "st-1", fileId: "f" }), permanentError: "rejected" };
    expect(lostOps([clip])).toEqual([]);
  });

  it("still reports a rename that could not be saved", () => {
    const rename = { ...op("session.update", { sessionId: "s1", name: "x" }), permanentError: "Unknown attribute" };
    expect(lostOps([rename])).toEqual([rename]);
  });
});
