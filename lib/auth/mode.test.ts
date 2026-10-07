import {
  canCoach,
  CHOSE_COACH_PREF_KEY,
  landingFor,
  MODE_PREF_KEY,
  modeToRecord,
  NO_MODE,
  readModePrefs,
  withMode,
  type Mode,
} from "./mode";

describe("where the root sends someone", () => {
  // Every signed-in combination, spelled out rather than derived, so a change
  // to any one row has to be made here on purpose.
  it.each<[Mode | null, boolean, boolean, string, Mode | null]>([
    // mode      links  offline  ->  to                adopt
    ["coach", false, false, "/coach/roster", null],
    ["coach", true, false, "/coach/roster", null],
    ["coach", false, true, "/coach/roster", null],
    ["coach", true, true, "/coach/roster", null],
    // Last-used wins over links: a coach who was last on the athlete side
    // opens there, athletes or not.
    ["athlete", false, false, "/today", null],
    ["athlete", true, false, "/today", null],
    ["athlete", false, true, "/today", null],
    ["athlete", true, true, "/today", null],
    // The migration: an account from before the question that already has
    // athletes is a coach, and the choice is saved for it rather than asked.
    [null, true, false, "/coach/roster", "coach"],
    // ...but never saved from a remembered session, which has no signal.
    [null, true, true, "/coach/roster", null],
    // Never chosen, nothing linked: the question.
    [null, false, false, "/welcome", null],
    // Unless offline, where the form cannot submit and Today still works.
    [null, false, true, "/today", null],
  ])("mode %s, links %s, offline %s -> %s (adopt %s)", (mode, hasLinks, offline, to, adopt) => {
    expect(landingFor({ signedIn: true, mode, hasLinks, offline })).toEqual({ to, adopt });
  });

  it.each<[Mode | null, boolean, boolean]>([
    ["coach", true, false],
    ["athlete", false, true],
    [null, true, true],
    [null, false, false],
  ])("sends a signed-out visitor to sign in whatever else is true (%s, %s, %s)", (mode, hasLinks, offline) => {
    expect(landingFor({ signedIn: false, mode, hasLinks, offline })).toEqual({ to: "/sign-in", adopt: null });
  });
});

describe("reading the mode out of account prefs", () => {
  // Prefs are a JSON bag any session can write for itself. Nothing in it may
  // throw on the root or route anywhere a real choice would not.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "coach"],
    ["an array", ["coach"]],
    ["an unknown mode", { [MODE_PREF_KEY]: "admin" }],
    ["the right word in the wrong case", { [MODE_PREF_KEY]: "Coach" }],
    ["a number", { [MODE_PREF_KEY]: 1 }],
    ["an object", { [MODE_PREF_KEY]: { mode: "coach" } }],
    ["a truthy string for the coach flag", { [CHOSE_COACH_PREF_KEY]: "true" }],
  ])("reads %s as never having chosen", (_label, prefs) => {
    expect(readModePrefs(prefs)).toEqual(NO_MODE);
  });

  it("routes garbage like a new account rather than like a coach", () => {
    const { mode } = readModePrefs({ [MODE_PREF_KEY]: "admin" });
    expect(landingFor({ signedIn: true, mode, hasLinks: false, offline: false }).to).toBe("/welcome");
  });

  it("reads both modes", () => {
    expect(readModePrefs({ [MODE_PREF_KEY]: "athlete" })).toEqual({ mode: "athlete", choseCoach: false });
    expect(readModePrefs({ [MODE_PREF_KEY]: "athlete", [CHOSE_COACH_PREF_KEY]: true })).toEqual({
      mode: "athlete",
      choseCoach: true,
    });
  });

  it("treats mode coach as having chosen coach even if the flag went missing", () => {
    expect(readModePrefs({ [MODE_PREF_KEY]: "coach" }).choseCoach).toBe(true);
  });
});

describe("the prefs object written back", () => {
  it("keeps every other key, because updatePrefs replaces the whole object", () => {
    const written = withMode({ theme: "dark", [MODE_PREF_KEY]: "athlete" }, "coach");
    expect(written).toEqual({ theme: "dark", [MODE_PREF_KEY]: "coach", [CHOSE_COACH_PREF_KEY]: true });
  });

  it("keeps the coach flag when a coach moves to the athlete side", () => {
    const written = withMode({ [MODE_PREF_KEY]: "coach", [CHOSE_COACH_PREF_KEY]: true }, "athlete");
    expect(readModePrefs(written)).toEqual({ mode: "athlete", choseCoach: true });
  });

  it("does not mark an athlete as a coach", () => {
    expect(withMode({}, "athlete")).toEqual({ [MODE_PREF_KEY]: "athlete" });
  });

  it("starts from nothing when what was stored is not an object", () => {
    expect(withMode("garbage", "athlete")).toEqual({ [MODE_PREF_KEY]: "athlete" });
    expect(withMode(null, "coach")).toEqual({ [MODE_PREF_KEY]: "coach", [CHOSE_COACH_PREF_KEY]: true });
  });
});

describe("what a shell records when it mounts", () => {
  it.each<[Mode | null, Mode, Mode | null]>([
    [null, "athlete", "athlete"],
    [null, "coach", "coach"],
    ["coach", "athlete", "athlete"],
    ["athlete", "coach", "coach"],
    // Unchanged writes nothing: a pref write per navigation is a request per tap.
    ["athlete", "athlete", null],
    ["coach", "coach", null],
  ])("saved %s, shell %s -> %s", (saved, shell, expected) => {
    expect(modeToRecord({ mode: saved, choseCoach: saved === "coach" }, shell)).toBe(expected);
  });
});

describe("who is offered the way into coach mode", () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])("chose coach %s, has athletes %s -> %s", (choseCoach, hasLinks, expected) => {
    expect(canCoach({ mode: "athlete", choseCoach }, hasLinks)).toBe(expected);
  });
});
