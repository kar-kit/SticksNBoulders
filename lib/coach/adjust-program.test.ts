import {
  adjustProgramHref,
  editorHref,
  editorViewFrom,
  idParam,
  landingFrom,
  resolveAdjustTarget,
  type TracedLine,
} from "./adjust-program";
import type { AthleteAccess } from "./athlete-view";
import type { Program } from "@/lib/programming/program";

const linked: AthleteAccess = { kind: "linked", linkedAt: null };

const program = (id: string, over: Partial<Program> = {}): Program => ({
  id,
  coachId: "ruairi",
  athleteId: "joey",
  name: id,
  status: "published",
  startOn: "2026-10-05",
  notes: null,
  templateId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const line = (over: Partial<TracedLine> = {}): TracedLine => ({
  id: "l1",
  athleteId: "joey",
  programId: "autumn",
  weekId: "w3",
  dayId: "d9",
  ...over,
});

describe("resolveAdjustTarget", () => {
  it("lands on the week and day the clip's set was prescribed from", () => {
    const target = resolveAdjustTarget({
      athleteId: "joey",
      access: linked,
      programs: [program("autumn"), program("newer", { updatedAt: "2026-10-06T00:00:00.000Z" })],
      line: line(),
    });
    expect(target).toEqual({
      kind: "editor",
      programId: "autumn",
      landing: { weekId: "w3", dayId: "d9", lineId: "l1" },
      traced: true,
    });
  });

  it("follows a line into a draft program too: it is still where the set came from", () => {
    const target = resolveAdjustTarget({
      athleteId: "joey",
      access: linked,
      programs: [program("autumn", { status: "draft" })],
      line: line(),
    });
    expect(target).toMatchObject({ kind: "editor", programId: "autumn", traced: true });
  });

  it("does not follow a line that belongs to somebody else, whatever the URL says", () => {
    const target = resolveAdjustTarget({
      athleteId: "joey",
      access: linked,
      programs: [program("current"), program("sams", { athleteId: "sam" })],
      line: line({ athleteId: "sam", programId: "sams" }),
    });
    expect(target).toEqual({ kind: "editor", programId: "current", landing: {}, traced: false });
  });

  it("falls back to the current program when the traced one is archived or gone", () => {
    const archived = resolveAdjustTarget({
      athleteId: "joey",
      access: linked,
      programs: [program("autumn", { status: "archived" }), program("winter")],
      line: line(),
    });
    expect(archived).toEqual({ kind: "editor", programId: "winter", landing: {}, traced: false });

    const gone = resolveAdjustTarget({ athleteId: "joey", access: linked, programs: [program("winter")], line: null });
    expect(gone).toMatchObject({ kind: "editor", programId: "winter", traced: false });
  });

  it("picks the published program updated last, the rule Today and the Roster use", () => {
    const target = resolveAdjustTarget({
      athleteId: "joey",
      access: linked,
      programs: [
        program("old"),
        program("new", { updatedAt: "2026-10-06T00:00:00.000Z" }),
        program("draft", { status: "draft", updatedAt: "2026-10-07T00:00:00.000Z" }),
      ],
      line: null,
    });
    expect(target).toMatchObject({ kind: "editor", programId: "new" });
  });

  it("lists their programs when none is live", () => {
    const target = resolveAdjustTarget({
      athleteId: "joey",
      access: linked,
      programs: [program("draft", { status: "draft" }), program("sams", { athleteId: "sam" })],
      line: null,
    });
    expect(target).toEqual({ kind: "list", programs: [program("draft", { status: "draft" })] });
  });

  it("says nothing has been written when nothing has", () => {
    expect(resolveAdjustTarget({ athleteId: "joey", access: linked, programs: [], line: null })).toEqual({ kind: "none" });
  });

  it("refuses without an active link, even with a readable program and a matching line", () => {
    // The coach's read of a program they wrote survives a revoke, so a row
    // coming back is not evidence they still coach this athlete.
    for (const access of [
      { kind: "not-linked" },
      { kind: "revoked", revokedAt: null },
    ] satisfies AthleteAccess[]) {
      const target = resolveAdjustTarget({ athleteId: "joey", access, programs: [program("autumn")], line: line() });
      expect(target).toEqual({ kind: "refused", access });
    }
  });
});

describe("URLs", () => {
  it("carries the athlete, and the line when the set has one", () => {
    expect(adjustProgramHref("joey")).toBe("/coach/programs?athlete=joey");
    expect(adjustProgramHref("joey", "l1")).toBe("/coach/programs?athlete=joey&line=l1");
    expect(adjustProgramHref("joey", null)).toBe("/coach/programs?athlete=joey");
  });

  it("opens the editor on a week and day, and plainly without one", () => {
    expect(editorHref("p1", { weekId: "w3", dayId: "d9", lineId: "l1" })).toBe(
      "/coach/programs/p1?week=w3&day=d9&line=l1",
    );
    expect(editorHref("p1", {})).toBe("/coach/programs/p1");
  });

  it("reads back only what looks like a row id", () => {
    expect(landingFrom({ week: "w3", day: ["d9", "d10"], line: "../../etc" })).toEqual({ weekId: "w3", dayId: "d9" });
    expect(idParam(undefined)).toBeNull();
    expect(idParam("")).toBeNull();
    expect(idParam("a".repeat(37))).toBeNull();
    expect(idParam("joey")).toBe("joey");
  });

  it("reads the editor's view: calendar only when asked for, week otherwise", () => {
    expect(editorViewFrom({ view: "calendar" })).toBe("calendar");
    expect(editorViewFrom({ view: ["calendar", "week"] })).toBe("calendar");
    expect(editorViewFrom({ view: "month" })).toBe("week");
    expect(editorViewFrom({})).toBe("week");
  });
});
