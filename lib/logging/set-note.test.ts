import { SET_NOTE_MAX, noteAnnouncement, noteCounter, noteOf } from "./set-note";

describe("noteOf", () => {
  it("trims what was typed", () => {
    expect(noteOf("  left hip pinched \n")).toBe("left hip pinched");
  });

  it("is null for nothing, blank or whitespace: that is a cleared note", () => {
    expect(noteOf(undefined)).toBeNull();
    expect(noteOf(null)).toBeNull();
    expect(noteOf("")).toBeNull();
    expect(noteOf("   \n ")).toBeNull();
  });

  it("caps to the column", () => {
    expect(noteOf("x".repeat(SET_NOTE_MAX + 20))).toHaveLength(SET_NOTE_MAX);
  });

  it("keeps line breaks inside the note", () => {
    expect(noteOf("belt loose\nbar path forward")).toBe("belt loose\nbar path forward");
  });
});

describe("noteCounter", () => {
  it("is silent until the last hundred characters", () => {
    expect(noteCounter("felt slow")).toBeNull();
    expect(noteCounter("x".repeat(SET_NOTE_MAX - 101))).toBeNull();
    expect(noteCounter("x".repeat(SET_NOTE_MAX - 100))).toBe("100 left");
  });

  it("never counts below zero", () => {
    expect(noteCounter("x".repeat(SET_NOTE_MAX))).toBe("0 left");
    expect(noteCounter("x".repeat(SET_NOTE_MAX + 5))).toBe("0 left");
  });
});

describe("noteAnnouncement", () => {
  it("speaks only at a few steps, not on every key", () => {
    expect(noteAnnouncement("short")).toBeNull();
    expect(noteAnnouncement("x".repeat(SET_NOTE_MAX - 100))).toBe("100 characters left");
    expect(noteAnnouncement("x".repeat(SET_NOTE_MAX - 99))).toBeNull();
    expect(noteAnnouncement("x".repeat(SET_NOTE_MAX - 50))).toBe("50 characters left");
    expect(noteAnnouncement("x".repeat(SET_NOTE_MAX - 10))).toBe("10 characters left");
    expect(noteAnnouncement("x".repeat(SET_NOTE_MAX))).toBe("Note is full");
  });
});
