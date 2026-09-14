import { beginEdit, padDisplay, padValue, press, rpeAfterWarmupChange, type PadKey, type PadState } from "./number-pad";

const type = (state: PadState, keys: string): PadState =>
  [...keys].reduce((s, k) => press(s, k as PadKey), state);

const load = (value: number | null = null) => beginEdit("load", value);
const reps = (value: number | null = null) => beginEdit("reps", value);

describe("typing over an existing value", () => {
  it("replaces it, the way a selected number behaves", () => {
    // 142.5 quietly becoming 142.57 is a wrong number in someone's log.
    expect(padValue(type(load(142.5), "6"))).toBe(6);
  });

  it("appends after the first keypress", () => {
    expect(padValue(type(load(142.5), "60"))).toBe(60);
  });

  it("shows the existing value until something is typed", () => {
    expect(padDisplay(load(142.5))).toBe("142.5");
  });

  it("drops trailing zeroes so 145.0 opens as 145", () => {
    expect(padDisplay(load(145.0))).toBe("145");
  });
});

describe("decimals", () => {
  it("takes one point and ignores a second", () => {
    expect(padDisplay(type(load(), "142.5.5"))).toBe("142.55");
  });

  it("reads a leading point as nought point, which is what .5 means", () => {
    expect(padValue(type(load(), ".5"))).toBe(0.5);
  });

  it("treats a trailing point as the whole number", () => {
    expect(padValue(type(load(), "142."))).toBe(142);
  });

  it("stops at two decimal places, which is finer than any plate", () => {
    expect(padDisplay(type(load(), "100.1259"))).toBe("100.12");
  });

  it("refuses a decimal point in reps", () => {
    expect(padDisplay(type(reps(), "5.5"))).toBe("55");
  });
});

describe("limits", () => {
  it("caps a load past anything a human lifts", () => {
    expect(padDisplay(type(load(), "123456"))).toBe("1234");
  });

  it("caps reps at three digits", () => {
    expect(padDisplay(type(reps(), "12345"))).toBe("123");
  });

  it("never keeps a leading zero", () => {
    expect(padDisplay(type(load(), "05"))).toBe("5");
    expect(padValue(type(reps(), "007"))).toBe(7);
  });
});

describe("backspace", () => {
  it("edits the existing value rather than clearing it", () => {
    // Correcting the last digit of 142.5 means 142., not starting again.
    const state = press(load(142.5), "back");
    expect(padDisplay(state)).toBe("142.");
    expect(padValue(state)).toBe(142);
  });

  it("leaves nothing usable when everything is deleted", () => {
    let state = load(60);
    for (let i = 0; i < 4; i += 1) state = press(state, "back");
    expect(padValue(state)).toBeNull();
    expect(padDisplay(state)).toBe("0");
  });

  it("shows a nought rather than collapsing the cell", () => {
    expect(padDisplay({ field: "load", text: "", replacing: false })).toBe("0");
  });
});

describe("marking a set as a warm-up", () => {
  it("drops any RPE already entered", () => {
    // Warm-ups never ask for RPE and are excluded from PRs and rollups, so one
    // carrying an RPE is a value nothing reads and everything has to explain.
    expect(rpeAfterWarmupChange(true, 8)).toBeNull();
  });

  it("leaves it alone on a working set", () => {
    expect(rpeAfterWarmupChange(false, 8)).toBe(8);
  });
});
