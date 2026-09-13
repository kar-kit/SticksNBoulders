import { startOfWeek, isSameWeek } from "../dates";

describe("startOfWeek", () => {
  it("returns the same date for a Monday", () => {
    const monday = new Date("2026-03-02T15:30:00.000Z"); // a Monday
    const result = startOfWeek(monday);
    expect(result.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("rolls a Tuesday back to the preceding Monday", () => {
    const tuesday = new Date("2026-03-03T10:00:00.000Z");
    expect(startOfWeek(tuesday).toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("rolls a Saturday back to the same week's Monday", () => {
    const saturday = new Date("2026-03-07T23:59:59.000Z");
    expect(startOfWeek(saturday).toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("rolls a Sunday back to the PRECEDING Monday (week ends Sunday, not starts it)", () => {
    // 2026-03-08 is the Sunday belonging to the week that started Mon 03-02.
    const sunday = new Date("2026-03-08T12:00:00.000Z");
    expect(startOfWeek(sunday).toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("handles a month boundary correctly", () => {
    // 2026-03-01 is a Sunday, belonging to the week starting Mon 2026-02-23.
    const date = new Date("2026-03-01T00:00:00.000Z");
    expect(startOfWeek(date).toISOString()).toBe("2026-02-23T00:00:00.000Z");
  });

  it("handles a year boundary correctly", () => {
    // 2026-01-01 is a Thursday, week starts Mon 2025-12-29.
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(startOfWeek(date).toISOString()).toBe("2025-12-29T00:00:00.000Z");
  });

  it("defaults to the current date when none is given", () => {
    expect(() => startOfWeek()).not.toThrow();
  });

  it("truncates the time of day to midnight UTC", () => {
    const lateNight = new Date("2026-03-04T23:59:59.999Z");
    const result = startOfWeek(lateNight);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

describe("isSameWeek", () => {
  it("returns true for two dates in the same Mon-Sun week", () => {
    const monday = new Date("2026-03-02T01:00:00.000Z");
    const saturday = new Date("2026-03-07T23:00:00.000Z");
    expect(isSameWeek(monday, saturday)).toBe(true);
  });

  it("returns false for a Sunday vs. the following Monday", () => {
    const sunday = new Date("2026-03-08T23:59:00.000Z");
    const nextMonday = new Date("2026-03-09T00:01:00.000Z");
    expect(isSameWeek(sunday, nextMonday)).toBe(false);
  });

  it("returns true comparing a date against itself", () => {
    const date = new Date("2026-03-05T12:00:00.000Z");
    expect(isSameWeek(date, date)).toBe(true);
  });

  it("defaults the second argument to now", () => {
    const now = new Date();
    expect(isSameWeek(now)).toBe(true);
  });
});
