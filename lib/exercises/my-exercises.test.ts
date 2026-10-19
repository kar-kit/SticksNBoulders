import { describe, expect, it } from "vitest";
import { newOp } from "@/lib/offline/queue";
import { checkRename, deleteRefusal, hasQueuedSets, myExercises } from "./my-exercises";
import type { Exercise } from "./match";

const ex = (id: string, name: string, over: Partial<Exercise> = {}): Exercise => ({
  id,
  name,
  normalisedName: name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
  isGlobal: false,
  ownerId: "joey",
  ...over,
});

const library = [
  ex("squat", "Squat", { isGlobal: true, ownerId: null }),
  ex("ex-1", "romainian dl"),
  ex("ex-2", "Pin Press"),
  ex("ex-3", "Coach's lift", { ownerId: "someone-else" }),
];

describe("myExercises", () => {
  it("lists only this athlete's own rows, A to Z", () => {
    expect(myExercises(library, "joey").map((e) => e.id)).toEqual(["ex-2", "ex-1"]);
  });
});

describe("checkRename", () => {
  const mine = library[1];

  it("allows a fresh name, tidied", () => {
    expect(checkRename(mine, "  Romanian   DL ", library)).toEqual({ ok: true, name: "Romanian DL", unchanged: false });
  });

  it("allows a change of case on the same exercise", () => {
    expect(checkRename(mine, "Romainian DL", library)).toMatchObject({ ok: true });
  });

  it("knows an unchanged name needs no write", () => {
    expect(checkRename(mine, "romainian dl", library)).toMatchObject({ ok: true, unchanged: true });
  });

  it("refuses a name the library already has, saying which", () => {
    expect(checkRename(mine, "squat", library)).toEqual({
      ok: false,
      message: "Squat is already in the library. Pick another name.",
    });
    expect(checkRename(mine, "PIN PRESS", library)).toEqual({
      ok: false,
      message: "You already have Pin Press. Pick another name.",
    });
  });

  it("refuses a blank or overlong name", () => {
    expect(checkRename(mine, "  ", library)).toMatchObject({ ok: false });
    expect(checkRename(mine, "x".repeat(65), library)).toMatchObject({ ok: false });
  });
});

describe("deleteRefusal", () => {
  const none = { sets: false, referenceMaxes: false, prescriptions: false };

  it("allows deleting an exercise nothing points at", () => {
    expect(deleteRefusal("Pin Press", none)).toBeNull();
  });

  it("blocks one with logged sets, on the server or still on the phone", () => {
    expect(deleteRefusal("Pin Press", { ...none, sets: true })).toMatch(/logged sets of Pin Press/);
    expect(deleteRefusal("Pin Press", none, true)).toMatch(/logged sets/);
  });

  it("blocks one with a max or a program line", () => {
    expect(deleteRefusal("Pin Press", { ...none, referenceMaxes: true })).toMatch(/max/);
    expect(deleteRefusal("Pin Press", { ...none, prescriptions: true })).toMatch(/coach has programmed/);
  });
});

describe("hasQueuedSets", () => {
  it("sees a set logged against it that has not synced", () => {
    const ops = [newOp("set.create", { setId: "st-1", exerciseId: "ex-1" }, 0, "op-0", 0)];
    expect(hasQueuedSets(ops, "ex-1")).toBe(true);
    expect(hasQueuedSets(ops, "ex-2")).toBe(false);
  });
});
