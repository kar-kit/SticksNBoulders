import { describe, expect, it } from "vitest";
import { videoAsk } from "./video-prompt";

const line = (setCount: number, videoRequired = false) => ({ setCount, videoRequired });

describe("videoAsk", () => {
  it("asks for nothing when no line is flagged", () => {
    expect(videoAsk({ lines: [line(3), line(2)], loggedWorking: 5, hasClip: false })).toBe("none");
  });

  it("asks for nothing on an exercise nobody prescribed", () => {
    expect(videoAsk({ lines: null, loggedWorking: 3, hasClip: false })).toBe("none");
    expect(videoAsk({ lines: undefined, loggedWorking: 3, hasClip: false })).toBe("none");
  });

  it("treats a line with the flag absent as not flagged", () => {
    expect(videoAsk({ lines: [{ setCount: 3 }], loggedWorking: 3, hasClip: false })).toBe("none");
  });

  it("emphasises the camera while the flagged line's sets are still to do", () => {
    expect(videoAsk({ lines: [line(3, true)], loggedWorking: 0, hasClip: false })).toBe("emphasise");
    expect(videoAsk({ lines: [line(3, true)], loggedWorking: 2, hasClip: false })).toBe("emphasise");
  });

  it("prompts once every set of the flagged line is logged without a clip", () => {
    expect(videoAsk({ lines: [line(3, true)], loggedWorking: 3, hasClip: false })).toBe("prompt");
    expect(videoAsk({ lines: [line(3, true)], loggedWorking: 4, hasClip: false })).toBe("prompt");
  });

  it("stops asking the moment a clip exists, on any set of the exercise", () => {
    expect(videoAsk({ lines: [line(3, true)], loggedWorking: 3, hasClip: true })).toBe("none");
    expect(videoAsk({ lines: [line(3, true)], loggedWorking: 0, hasClip: true })).toBe("none");
  });

  it("counts a flagged line's sets by position, so a top set is done before its backoffs", () => {
    const lines = [line(1, true), line(3)];
    expect(videoAsk({ lines, loggedWorking: 0, hasClip: false })).toBe("emphasise");
    expect(videoAsk({ lines, loggedWorking: 1, hasClip: false })).toBe("prompt");
  });

  it("waits for the last flagged line when several are flagged", () => {
    const lines = [line(1, true), line(2), line(2, true)];
    expect(videoAsk({ lines, loggedWorking: 1, hasClip: false })).toBe("emphasise");
    expect(videoAsk({ lines, loggedWorking: 5, hasClip: false })).toBe("prompt");
  });

  it("counts a backoff rule's sets (Order 21) as positions before a later flagged line", () => {
    const lines = [{ setCount: 1, backoffSets: 3 }, { setCount: 2, videoRequired: true }];
    expect(videoAsk({ lines, loggedWorking: 4, hasClip: false })).toBe("emphasise");
    expect(videoAsk({ lines, loggedWorking: 6, hasClip: false })).toBe("prompt");
  });

  it("treats a flagged top set with a backoff rule as done after the top set", () => {
    const lines = [{ setCount: 1, videoRequired: true, backoffSets: 3 }];
    expect(videoAsk({ lines, loggedWorking: 1, hasClip: false })).toBe("prompt");
  });
});
