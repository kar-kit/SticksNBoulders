import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetActiveSession,
  recallActiveSession,
  rememberActiveSession,
} from "./active-session-cache";
import type { SessionRecord } from "./session";

const STARTED = new Date("2026-09-14T09:00:00Z");
const session: SessionRecord = {
  id: "cs-1",
  clientSessionId: "cs-1",
  startedAt: STARTED,
  finishedAt: null,
  setCount: 0,
  tonnageKg: 0,
  notes: null,
};

beforeEach(() => localStorage.clear());

it("gives the session back after a cold start with no signal", () => {
  rememberActiveSession("joey", session);
  expect(recallActiveSession("joey", new Date("2026-09-14T09:40:00Z"))).toMatchObject({ id: "cs-1" });
});

it("forgets it once the session is finished", () => {
  rememberActiveSession("joey", session);
  forgetActiveSession();
  expect(recallActiveSession("joey")).toBeNull();
});

it("does not hand one athlete's session to another account on the same phone", () => {
  rememberActiveSession("joey", session);
  expect(recallActiveSession("ruairi")).toBeNull();
});

it("stops believing it after half a day", () => {
  // A finish that never ran would otherwise leave a session that looks live
  // forever, and an athlete who can never start a new one.
  rememberActiveSession("joey", session);
  expect(recallActiveSession("joey", new Date("2026-09-14T20:00:00Z"))).toMatchObject({ id: "cs-1" });
  expect(recallActiveSession("joey", new Date("2026-09-14T22:00:00Z"))).toBeNull();
});

describe("when storage refuses", () => {
  it("carries on rather than failing the workout", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("quota");
    };
    expect(recallActiveSession("joey")).toBeNull();
    Storage.prototype.getItem = original;
  });
});
