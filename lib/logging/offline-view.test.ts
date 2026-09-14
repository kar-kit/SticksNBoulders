import { describe, expect, it } from "vitest";
import { newOp, type QueuedOp } from "@/lib/offline/queue";
import { mergeById, queuedSessions, queuedSets, unsyncedIds } from "./offline-view";
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
