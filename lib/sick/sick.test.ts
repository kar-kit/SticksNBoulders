import { applyEnd, coversDay, isSickOn, openSpells, planEnd, sickNow, toSpell, type SickSpell } from "./sick";
import { sickRangeLabel, sickShortRange } from "./labels";

const spell = (over: Partial<SickSpell> = {}): SickSpell => ({
  id: "sk-1",
  athleteId: "joey",
  startsOn: "2026-11-27",
  endsOn: "2026-11-29",
  note: null,
  createdAt: "2026-11-27T08:00:00.000Z",
  ...over,
});

describe("toSpell", () => {
  const row = { $id: "sk-1", athlete_id: "joey", starts_on: "2026-11-27", ends_on: "2026-11-29", note: "Flu", created_at: "2026-11-27T08:00:00.000Z" };

  it("reads a stored row", () => {
    expect(toSpell(row)).toEqual({ id: "sk-1", athleteId: "joey", startsOn: "2026-11-27", endsOn: "2026-11-29", note: "Flu", createdAt: "2026-11-27T08:00:00.000Z" });
  });

  it("reads a missing or empty note as none", () => {
    expect(toSpell({ ...row, note: null })?.note).toBeNull();
    expect(toSpell({ ...row, note: "" })?.note).toBeNull();
    expect(toSpell({ ...row, note: undefined })?.note).toBeNull();
  });

  it("drops what validate-row would delete, so it is never drawn in the meantime", () => {
    expect(toSpell({ ...row, starts_on: "2026-11-30" })).toBeNull();
    expect(toSpell({ ...row, ends_on: "2062-11-27" })).toBeNull();
    expect(toSpell({ ...row, starts_on: "2026-13-45" })).toBeNull();
    expect(toSpell({ ...row, ends_on: undefined })).toBeNull();
  });

  it("drops a row with no id or no athlete", () => {
    expect(toSpell({ ...row, $id: "" })).toBeNull();
    expect(toSpell({ ...row, athlete_id: undefined })).toBeNull();
  });
});

describe("coversDay and isSickOn", () => {
  it("includes both ends of the range, and nothing either side", () => {
    const span = { startsOn: "2026-11-27", endsOn: "2026-11-29" };
    expect(coversDay(span, "2026-11-26")).toBe(false);
    expect(coversDay(span, "2026-11-27")).toBe(true);
    expect(coversDay(span, "2026-11-28")).toBe(true);
    expect(coversDay(span, "2026-11-29")).toBe(true);
    expect(coversDay(span, "2026-11-30")).toBe(false);
  });

  it("is the union of every call-in, so overlap and gaps both work", () => {
    const spans = [spell({ startsOn: "2026-11-27", endsOn: "2026-11-28" }), spell({ id: "b", startsOn: "2026-12-01", endsOn: "2026-12-01" })];
    expect(isSickOn(spans, "2026-11-28")).toBe(true);
    expect(isSickOn(spans, "2026-11-30")).toBe(false);
    expect(isSickOn(spans, "2026-12-01")).toBe(true);
    expect(isSickOn([], "2026-11-28")).toBe(false);
  });
});

describe("openSpells", () => {
  it("keeps the call-ins that have not finished before today, earliest first", () => {
    const gone = spell({ id: "gone", startsOn: "2026-11-20", endsOn: "2026-11-22" });
    const now = spell({ id: "now", startsOn: "2026-11-26", endsOn: "2026-11-28" });
    const ahead = spell({ id: "ahead", startsOn: "2026-12-03", endsOn: "2026-12-04" });
    expect(openSpells([ahead, gone, now], "2026-11-27").map((s) => s.id)).toEqual(["now", "ahead"]);
    // Ending today is still open: it is today.
    expect(openSpells([spell({ endsOn: "2026-11-27" })], "2026-11-27")).toHaveLength(1);
  });
});

describe("sickNow", () => {
  it("is null when no call-in covers today, including one still to come", () => {
    expect(sickNow([], "2026-11-27")).toBeNull();
    expect(sickNow([spell({ startsOn: "2026-11-28", endsOn: "2026-11-29" })], "2026-11-27")).toBeNull();
    expect(sickNow([spell({ startsOn: "2026-11-20", endsOn: "2026-11-26" })], "2026-11-27")).toBeNull();
  });

  it("gives the dates of the call-in covering today, and its note", () => {
    expect(sickNow([spell({ note: "Flu" })], "2026-11-28")).toEqual({ startsOn: "2026-11-27", endsOn: "2026-11-29", note: "Flu" });
  });

  it("runs back-to-back call-ins together: sick today and then 'and tomorrow' is sick until the end of the second", () => {
    const first = spell({ id: "a", startsOn: "2026-11-27", endsOn: "2026-11-27", note: "Flu" });
    const second = spell({ id: "b", startsOn: "2026-11-28", endsOn: "2026-11-30", createdAt: "2026-11-28T08:00:00.000Z", note: null });
    expect(sickNow([first, second], "2026-11-27")).toEqual({ startsOn: "2026-11-27", endsOn: "2026-11-30", note: "Flu" });
  });

  it("does not bridge a gap of a day or more", () => {
    const first = spell({ id: "a", startsOn: "2026-11-27", endsOn: "2026-11-27" });
    const later = spell({ id: "b", startsOn: "2026-11-29", endsOn: "2026-11-30" });
    expect(sickNow([first, later], "2026-11-27")?.endsOn).toBe("2026-11-27");
  });

  it("follows overlapping call-ins to the latest end, in any order", () => {
    const a = spell({ id: "a", startsOn: "2026-11-27", endsOn: "2026-11-29" });
    const b = spell({ id: "b", startsOn: "2026-11-28", endsOn: "2026-12-02" });
    const c = spell({ id: "c", startsOn: "2026-12-03", endsOn: "2026-12-04" });
    expect(sickNow([c, b, a], "2026-11-28")?.endsOn).toBe("2026-12-04");
  });

  it("uses the newest note that covers today, and none when none of them left one", () => {
    const old = spell({ id: "a", note: "Flu", createdAt: "2026-11-27T08:00:00.000Z" });
    const fresh = spell({ id: "b", note: "Worse, sorry", createdAt: "2026-11-28T08:00:00.000Z" });
    expect(sickNow([old, fresh], "2026-11-28")?.note).toBe("Worse, sorry");
    expect(sickNow([spell()], "2026-11-28")?.note).toBeNull();
  });
});

describe("planEnd", () => {
  it("shortens a call-in that began before today to end yesterday, keeping the days already spent sick", () => {
    expect(planEnd([spell({ startsOn: "2026-11-25", endsOn: "2026-11-29" })], "2026-11-27")).toEqual([{ sickId: "sk-1", endsOn: "2026-11-26" }]);
  });

  it("removes one that begins today or later: there is nothing left of it to keep", () => {
    expect(planEnd([spell({ startsOn: "2026-11-27", endsOn: "2026-11-29" })], "2026-11-27")).toEqual([{ sickId: "sk-1", endsOn: null }]);
    expect(planEnd([spell({ startsOn: "2026-12-03", endsOn: "2026-12-04" })], "2026-11-27")).toEqual([{ sickId: "sk-1", endsOn: null }]);
  });

  it("leaves a call-in that already ended alone", () => {
    expect(planEnd([spell({ startsOn: "2026-11-20", endsOn: "2026-11-26" })], "2026-11-27")).toEqual([]);
  });

  it("handles every call-in at once", () => {
    const spells = [
      spell({ id: "past", startsOn: "2026-11-20", endsOn: "2026-11-26" }),
      spell({ id: "under-way", startsOn: "2026-11-25", endsOn: "2026-11-28" }),
      spell({ id: "ahead", startsOn: "2026-12-01", endsOn: "2026-12-02" }),
    ];
    expect(planEnd(spells, "2026-11-27")).toEqual([
      { sickId: "under-way", endsOn: "2026-11-26" },
      { sickId: "ahead", endsOn: null },
    ]);
  });

  it("crosses a month and a year, in calendar days", () => {
    expect(planEnd([spell({ startsOn: "2026-12-30", endsOn: "2027-01-03" })], "2027-01-01")).toEqual([{ sickId: "sk-1", endsOn: "2026-12-31" }]);
    expect(planEnd([spell({ startsOn: "2026-11-30", endsOn: "2026-12-03" })], "2026-12-01")).toEqual([{ sickId: "sk-1", endsOn: "2026-11-30" }]);
  });

  it("never plans an end before the call-in began, so the row stays a range", () => {
    for (const startsOn of ["2026-11-24", "2026-11-26", "2026-11-27"]) {
      const [action] = planEnd([spell({ startsOn, endsOn: "2026-11-29" })], "2026-11-27");
      if (action.endsOn !== null) expect(action.endsOn >= startsOn).toBe(true);
    }
  });

  it("is idempotent: planning again on the result plans nothing", () => {
    const spells = [spell({ id: "a", startsOn: "2026-11-25", endsOn: "2026-11-29" }), spell({ id: "b", startsOn: "2026-12-01", endsOn: "2026-12-02" })];
    const after = applyEnd(spells, planEnd(spells, "2026-11-27"));
    expect(planEnd(after, "2026-11-27")).toEqual([]);
  });
});

describe("applyEnd", () => {
  it("shortens what the actions shorten, removes what they delete, and leaves the rest", () => {
    const spells = [spell({ id: "a", startsOn: "2026-11-25", endsOn: "2026-11-29" }), spell({ id: "b" }), spell({ id: "c", startsOn: "2026-10-01", endsOn: "2026-10-02" })];
    const after = applyEnd(spells, [
      { sickId: "a", endsOn: "2026-11-26" },
      { sickId: "b", endsOn: null },
    ]);
    expect(after.map((s) => [s.id, s.endsOn])).toEqual([
      ["a", "2026-11-26"],
      ["c", "2026-10-02"],
    ]);
  });
});

describe("labels", () => {
  it("reads one day with its weekday as My Program does, and a run as from and to", () => {
    expect(sickRangeLabel("2026-11-27", "2026-11-27")).toBe("Friday 27 Nov");
    expect(sickRangeLabel("2026-11-27", "2026-11-29")).toBe("Friday 27 Nov to Sunday 29 Nov");
  });

  it("reads the coach's side in the format the Roster already uses", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    expect(sickShortRange("2026-11-27", "2026-11-27", now)).toBe("27 Nov");
    expect(sickShortRange("2026-11-27", "2026-11-29", now)).toBe("27 Nov to 29 Nov");
    expect(sickShortRange("2026-12-30", "2027-01-02", now)).toBe("30 Dec to 2 Jan 2027");
  });

  it("says nothing for a day that is not one, rather than a wrong date", () => {
    expect(sickRangeLabel("nope", "2026-11-27")).toBe("");
    expect(sickShortRange("2026-13-45", "2026-11-27")).toBe("");
  });
});
