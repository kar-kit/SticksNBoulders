import { beforeEach, expect, it } from "vitest";
import { forgetRest, recallRest, rememberRest } from "./rest-store";

const START = new Date("2026-09-14T10:00:00Z");

beforeEach(() => localStorage.clear());

it("gives a running rest back after a reload", () => {
  rememberRest({ startedAt: START, restMs: 150_000 });
  expect(recallRest(new Date("2026-09-14T10:00:40Z"))).toEqual({
    startedAt: START,
    restMs: 150_000,
  });
});

it("forgets it when it is skipped", () => {
  rememberRest({ startedAt: START, restMs: 120_000 });
  forgetRest();
  expect(recallRest()).toBeNull();
});

it("stops believing a rest from an hour ago", () => {
  // A phone reopened the next morning would otherwise show a timer that has
  // been counting up all night, and an athlete wondering how to get rid of it.
  rememberRest({ startedAt: START, restMs: 120_000 });
  expect(recallRest(new Date("2026-09-14T10:59:00Z"))).not.toBeNull();
  expect(recallRest(new Date("2026-09-14T11:30:00Z"))).toBeNull();
});

it("ignores a stored value it cannot read", () => {
  localStorage.setItem("snb.rest-timer", "{not json");
  expect(recallRest()).toBeNull();
});
