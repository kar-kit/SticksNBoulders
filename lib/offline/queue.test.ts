import { describe, expect, it } from "vitest";
import {
  afterFailure,
  backoffMs,
  classify,
  collapsibleCreate,
  failedOps,
  newOp,
  pendingClientIds,
  pendingOps,
  readyPrefix,
  type QueuedOp,
} from "./queue";

const op = (overrides: Partial<QueuedOp> = {}): QueuedOp => ({
  id: "op-1",
  kind: "set.create",
  payload: { setId: "st-1" },
  sequence: 0,
  attempts: 0,
  nextAttemptAt: 0,
  ...overrides,
});

describe("classify", () => {
  it("treats a conflict as the write having already landed", () => {
    // The row id is the client id, so a 409 can only mean our own first attempt.
    expect(classify({ code: 409 })).toBe("done");
  });

  it("retries a failure with no status at all", () => {
    // No signal, DNS gone, a captive portal eating the request.
    expect(classify(new TypeError("Failed to fetch"))).toBe("retry");
  });

  it("retries what the server may answer differently later", () => {
    for (const code of [401, 403, 408, 429, 500, 503]) {
      expect(classify({ code })).toBe("retry");
    }
  });

  it("gives up on a request the server will always reject", () => {
    // The failure mode this exists to prevent: one malformed op at the head of
    // the queue, retried forever, with every real set stuck behind it.
    expect(classify({ code: 400 })).toBe("permanent");
    expect(classify({ code: 404 })).toBe("permanent");
  });
});

describe("backoffMs", () => {
  it("doubles and then stops doubling", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(30)).toBe(60_000);
  });
});

describe("readyPrefix", () => {
  it("hands back the queue in the order it was written", () => {
    const ops = [op({ id: "b", sequence: 2 }), op({ id: "a", sequence: 1 })];
    expect(readyPrefix(ops, 100).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("holds everything behind an op that is still backing off", () => {
    // A set must never reach Appwrite before the session it belongs to, so a
    // waiting op blocks the line rather than being stepped over.
    const ops = [
      op({ id: "a", sequence: 1, nextAttemptAt: 5000 }),
      op({ id: "b", sequence: 2, nextAttemptAt: 0 }),
    ];
    expect(readyPrefix(ops, 1000)).toEqual([]);
  });

  it("steps over an op that can never succeed", () => {
    const ops = [
      op({ id: "a", sequence: 1, permanentError: "rejected" }),
      op({ id: "b", sequence: 2 }),
    ];
    expect(readyPrefix(ops, 1000).map((o) => o.id)).toEqual(["b"]);
  });
});

describe("afterFailure", () => {
  it("backs a retryable op off further each time", () => {
    const once = afterFailure(op(), "retry", new Error("offline"), 1000);
    expect(once.attempts).toBe(1);
    expect(once.nextAttemptAt).toBe(3000);

    const twice = afterFailure(once, "retry", new Error("offline"), 3000);
    expect(twice.nextAttemptAt).toBe(7000);
  });

  it("marks a permanent failure so it stops blocking the queue", () => {
    const dead = afterFailure(op(), "permanent", { code: 400, message: "bad reps" });
    expect(dead.permanentError).toBe("bad reps");
    expect(pendingOps([dead])).toEqual([]);
    expect(failedOps([dead])).toHaveLength(1);
  });
});

describe("collapsibleCreate", () => {
  it("cancels a set that has never been sent", () => {
    const ops = [op({ id: "a", payload: { setId: "st-9" } })];
    expect(collapsibleCreate(ops, "set.create", "st-9")?.id).toBe("a");
  });

  it("refuses once the write has been attempted", () => {
    // It may have landed with the response lost on the way back. Dropping it
    // here would leave a set on the server the athlete believes they undid.
    const ops = [op({ id: "a", attempts: 1, payload: { setId: "st-9" } })];
    expect(collapsibleCreate(ops, "set.create", "st-9")).toBeNull();
  });
});

describe("pendingClientIds", () => {
  it("names every row still on its way", () => {
    const ops = [
      op({ id: "a", kind: "session.create", payload: { sessionId: "cs-1" } }),
      op({ id: "b", payload: { setId: "st-1" } }),
      op({ id: "c", payload: { setId: "st-2" }, permanentError: "gone" }),
    ];
    expect([...pendingClientIds(ops)]).toEqual(["cs-1", "st-1"]);
  });
});

describe("newOp", () => {
  it("starts ready to run", () => {
    expect(newOp("set.create", { setId: "st-1" }, 4, "op-4", 900)).toMatchObject({
      sequence: 4,
      attempts: 0,
      nextAttemptAt: 900,
    });
  });
});
