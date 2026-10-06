import { readSeenAt, writeSeenAt } from "./feedback-seen";

beforeEach(() => localStorage.clear());

describe("the feedback watermark", () => {
  it("is null before the athlete has ever looked", () => {
    expect(readSeenAt("athlete")).toBeNull();
  });

  it("round-trips per user, so two people on one browser do not clear each other", () => {
    writeSeenAt("a", "2026-09-20T10:00:00.000Z");
    expect(readSeenAt("a")).toBe("2026-09-20T10:00:00.000Z");
    expect(readSeenAt("b")).toBeNull();
  });

  it("does not store a null, which would reset a real watermark", () => {
    writeSeenAt("a", "2026-09-20T10:00:00.000Z");
    writeSeenAt("a", null);
    expect(readSeenAt("a")).toBe("2026-09-20T10:00:00.000Z");
  });

  it("treats garbage in storage as never having looked", () => {
    localStorage.setItem("snb.feedback.seenAt.a", JSON.stringify("yesterday-ish"));
    expect(readSeenAt("a")).toBeNull();
  });
});
