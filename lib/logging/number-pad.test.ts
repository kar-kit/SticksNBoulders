import {
  beginEdit,
  canStepDown,
  padDisplay,
  padValue,
  press,
  rpeAfterWarmupChange,
  step,
  stepSize,
  type PadKey,
  type PadState,
} from "./number-pad";

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

describe("a load typed in pounds", () => {
  const pounds = (value: number | null = null) => beginEdit("load", value, "lb");

  it("takes one decimal, which is all the screen shows back", () => {
    expect(padValue(type(pounds(), "225.25"))).toBe(225.2);
  });

  it("still takes two in kilos, for micro-plates", () => {
    expect(padValue(type(beginEdit("load", null, "kg"), "142.25"))).toBe(142.25);
    expect(padValue(type(load(), "142.25"))).toBe(142.25);
  });

  it("remembers the unit it is typing in, and only for a load", () => {
    expect(pounds(225).unit).toBe("lb");
    expect(beginEdit("reps", 5, "lb").unit).toBeUndefined();
  });
});

describe("the − / + steppers", () => {
  it("moves a kilo load by 2.5 and reps by 1", () => {
    expect(padValue(step(load(140), 1))).toBe(142.5);
    expect(padValue(step(load(140), -1))).toBe(137.5);
    expect(padValue(step(reps(5), 1))).toBe(6);
    expect(padValue(step(reps(5), -1))).toBe(4);
  });

  it("moves a pound load by 5, the pound gym's plate pair", () => {
    const lb = beginEdit("load", 225, "lb");
    expect(stepSize(lb)).toBe(5);
    expect(padValue(step(lb, 1))).toBe(230);
    expect(step(lb, 1).unit).toBe("lb");
  });

  it("adds to what was typed rather than snapping it to the plate grid", () => {
    expect(padValue(step(load(141), 1))).toBe(143.5);
  });

  it("never goes below zero", () => {
    expect(padValue(step(load(1), -1))).toBe(0);
    expect(padValue(step(load(0), -1))).toBe(0);
    expect(padValue(step(reps(0), -1))).toBe(0);
    expect(canStepDown(reps(0))).toBe(false);
    expect(canStepDown(reps(1))).toBe(true);
  });

  it("starts an empty field from zero", () => {
    expect(padValue(step(load(), 1))).toBe(2.5);
    expect(padValue(step(reps(), 1))).toBe(1);
    expect(canStepDown(load())).toBe(false);
  });

  it("keeps float noise off the screen", () => {
    let state = load(0.1);
    for (let i = 0; i < 3; i++) state = step(state, 1);
    expect(padDisplay(state)).toBe("7.6");
  });

  it("selects the result, so the next digit replaces it", () => {
    expect(padValue(type(step(load(140), 1), "9"))).toBe(9);
  });

  it("stops at what the pad would let you type", () => {
    expect(padValue(step(reps(999), 1))).toBe(999);
    expect(padValue(step(load(9999), 1))).toBe(9999);
  });
});

describe("a cardio row's time (F23)", () => {
  const duration = (value: number | null = null) => beginEdit("duration", value);

  it("is minutes on their own: 20 is twenty minutes", () => {
    const typed = type(duration(), "20");
    expect(typed.text).toBe("20");
    expect(padValue(typed)).toBe(1200);
  });

  it("takes seconds after the decimal key, shown as a colon", () => {
    const typed = type(duration(), "20.30");
    expect(typed.text).toBe("20:30");
    expect(padValue(typed)).toBe(1230);
    // A separator first means 0 minutes.
    expect(padValue(type(duration(), ".45"))).toBe(45);
  });

  it("never lets seconds reach 60 or run past two digits, and takes one separator", () => {
    expect(type(duration(), "20.7").text).toBe("20:");
    expect(type(duration(), "20.599").text).toBe("20:59");
    expect(type(duration(), "20..3").text).toBe("20:3");
  });

  it("stops minutes at three digits and drops a leading zero", () => {
    expect(type(duration(), "12345").text).toBe("123");
    expect(type(duration(), "05").text).toBe("5");
  });

  it("opens on a stored time as minutes, or minutes and seconds, and the first key replaces it", () => {
    expect(duration(1200).text).toBe("20");
    expect(duration(1230).text).toBe("20:30");
    expect(type(duration(1200), "3").text).toBe("3");
  });

  it("steps a minute at a time, never below zero", () => {
    expect(stepSize(duration(1200))).toBe(60);
    expect(padValue(step(duration(1230), 1))).toBe(1290);
    expect(step(duration(1230), 1).text).toBe("21:30");
    expect(padValue(step(duration(30), -1))).toBe(0);
    expect(canStepDown(duration(0))).toBe(false);
  });

  it("backspaces a character at a time, through the separator", () => {
    const typed = press(press(type(duration(), "20.30"), "back"), "back");
    expect(typed.text).toBe("20:");
    expect(padValue(press(typed, "back"))).toBe(1200);
    expect(padValue(duration())).toBeNull();
  });
});

describe("a cardio row's level (F23)", () => {
  const level = (value: number | null = null) => beginEdit("level", value);

  it("takes two digits and one decimal", () => {
    expect(padValue(type(level(), "8"))).toBe(8);
    expect(padValue(type(level(), "2.5"))).toBe(2.5);
    expect(type(level(), "123").text).toBe("12");
    expect(type(level(), "2.55").text).toBe("2.5");
  });

  it("steps by one", () => {
    expect(stepSize(level(8))).toBe(1);
    expect(padValue(step(level(8), 1))).toBe(9);
  });
});
