import { readSeenAt, readSetSeen, writeSeenAt, writeSetSeen } from "./feedback-seen";

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

describe("per-clip read marks (F15)", () => {
  it("records one clip without touching the watermark", () => {
    writeSeenAt("a", "2026-09-20T10:00:00.000Z");
    writeSetSeen("a", "s1", "2026-09-22T10:00:00.000Z");
    expect(readSetSeen("a")).toEqual({ s1: "2026-09-22T10:00:00.000Z" });
    expect(readSeenAt("a")).toBe("2026-09-20T10:00:00.000Z");
    expect(readSetSeen("b")).toEqual({});
  });

  it("never moves a clip's mark back", () => {
    writeSetSeen("a", "s1", "2026-09-22T10:00:00.000Z");
    writeSetSeen("a", "s1", "2026-09-21T10:00:00.000Z");
    expect(readSetSeen("a").s1).toBe("2026-09-22T10:00:00.000Z");
  });

  it("adds nothing the watermark already covers, and drops marks it overtakes", () => {
    writeSeenAt("a", "2026-09-20T10:00:00.000Z");
    writeSetSeen("a", "old", "2026-09-19T10:00:00.000Z");
    expect(readSetSeen("a")).toEqual({});

    writeSetSeen("a", "s1", "2026-09-21T10:00:00.000Z");
    writeSetSeen("a", "s2", "2026-09-25T10:00:00.000Z");
    writeSeenAt("a", "2026-09-22T10:00:00.000Z");
    expect(readSetSeen("a")).toEqual({ s2: "2026-09-25T10:00:00.000Z" });
  });

  it("ignores garbage in storage", () => {
    localStorage.setItem("snb.feedback.seenSets.a", JSON.stringify({ s1: "soon", s2: 4, s3: "2026-09-21T10:00:00.000Z" }));
    expect(readSetSeen("a")).toEqual({ s3: "2026-09-21T10:00:00.000Z" });
    localStorage.setItem("snb.feedback.seenSets.a", JSON.stringify(["nope"]));
    expect(readSetSeen("a")).toEqual({});
  });
});
