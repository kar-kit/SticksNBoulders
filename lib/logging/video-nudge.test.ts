import { rememberNudged, wasNudged } from "./video-nudge";

beforeEach(() => localStorage.clear());

describe("the coach's video popup, once per exercise per session (F18)", () => {
  it("is not shown for anything until it has been", () => {
    expect(wasNudged("s1", "squat")).toBe(false);
  });

  it("remembers each exercise of the running session, without duplicates", () => {
    rememberNudged("s1", "squat");
    rememberNudged("s1", "squat");
    rememberNudged("s1", "bench");
    expect(wasNudged("s1", "squat")).toBe(true);
    expect(wasNudged("s1", "bench")).toBe(true);
    expect(wasNudged("s1", "deadlift")).toBe(false);
    expect(JSON.parse(localStorage.getItem("snb:video-nudged")!)).toEqual({ sessionId: "s1", blocks: ["squat", "bench"] });
  });

  it("starts again with the next session, and keeps nothing of the last", () => {
    rememberNudged("s1", "squat");
    expect(wasNudged("s2", "squat")).toBe(false);
    rememberNudged("s2", "bench");
    expect(wasNudged("s1", "squat")).toBe(false);
    expect(wasNudged("s2", "bench")).toBe(true);
  });

  it("reads storage it cannot parse as not shown yet", () => {
    localStorage.setItem("snb:video-nudged", "{not json");
    expect(wasNudged("s1", "squat")).toBe(false);
    rememberNudged("s1", "squat");
    expect(wasNudged("s1", "squat")).toBe(true);
  });
});
