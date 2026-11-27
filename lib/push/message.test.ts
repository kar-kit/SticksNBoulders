import {
  COACH_REVIEW_PATH,
  COACH_ROSTER_PATH,
  COACH_THREAD_ROUTE,
  coachAthletePath,
  coachClipPath,
  coachThreadPath,
  isAppPath,
} from "./links";
import { UNNAMED_ATHLETE, clipMessage, clipTag, collapsedTitle, replyMessage, replyTag, sickMessage, sickTag, testMessage } from "./message";

const A = "athlete_a";

describe("clipMessage", () => {
  const base = { athleteId: A, athleteName: "Joey", setId: "set1", videoFileId: "file1", exerciseName: "Squat" };

  it("collapses per athlete and counts per clip", () => {
    const m = clipMessage(base);
    expect(m.tag).toBe(clipTag(A));
    expect(m.key).toBe("set1:file1");
    // A replaced clip on the same set is a new thing to watch.
    expect(clipMessage({ ...base, videoFileId: "file2" }).key).not.toBe(m.key);
    expect(clipMessage({ ...base, setId: "set2" }).tag).toBe(m.tag);
  });

  it("opens that clip over the athlete's dashboard, or the queue once several collapse", () => {
    const m = clipMessage(base);
    expect(m.url).toBe("/coach/athletes/athlete_a?clip=set1");
    expect(m.groupUrl).toBe(COACH_REVIEW_PATH);
  });

  it("says who and what", () => {
    const m = clipMessage(base);
    expect(m.title).toBe("Joey uploaded a clip");
    expect(m.body).toBe("Squat · ready to review");
    expect(clipMessage({ ...base, exerciseName: null }).body).toBe("Ready to review");
  });

  it("names an athlete with no profile rather than leaving it blank", () => {
    expect(clipMessage({ ...base, athleteName: null }).title).toBe(`${UNNAMED_ATHLETE} uploaded a clip`);
    expect(clipMessage({ ...base, athleteName: "   " }).who).toBe(UNNAMED_ATHLETE);
  });
});

describe("sickMessage (F31)", () => {
  const base = { athleteId: A, athleteName: "Joey", sickId: "sk-1", startsOn: "2026-11-27", endsOn: "2026-11-27" };

  it("collapses per athlete, counts per call-in, and opens the Athlete View or the Roster once several collapse", () => {
    const m = sickMessage(base);
    expect(m.tag).toBe(sickTag(A));
    expect([sickTag(A), clipTag(A), replyTag(A)]).toHaveLength(new Set([sickTag(A), clipTag(A), replyTag(A)]).size);
    expect(m.key).toBe("sk-1");
    expect(sickMessage({ ...base, sickId: "sk-2" }).key).not.toBe(m.key);
    expect(m.url).toBe(coachAthletePath(A));
    expect(m.groupUrl).toBe(COACH_ROSTER_PATH);
  });

  it("says who and which days, with the weekday, read in UTC so no zone moves the day", () => {
    expect(sickMessage(base).title).toBe("Joey called in sick");
    expect(sickMessage(base).body).toBe("Fri 27 Nov");
    expect(sickMessage({ ...base, endsOn: "2026-12-01" }).body).toBe("Fri 27 Nov to Tue 1 Dec");
  });

  it("carries no note: health information stays off the lock screen", () => {
    expect(Object.keys(sickMessage(base)).sort()).toEqual(
      ["body", "groupUrl", "key", "kind", "tag", "title", "url", "v", "who"].sort(),
    );
  });

  it("names an athlete with no profile rather than leaving it blank", () => {
    expect(sickMessage({ ...base, athleteName: null }).title).toBe(`${UNNAMED_ATHLETE} called in sick`);
  });
});

describe("replyMessage", () => {
  const base = { athleteId: A, athleteName: "Joey", setId: "set1", commentId: "c1", body: "Felt the hips\n shoot up" };

  it("collapses per athlete, counts per reply, and opens the thread", () => {
    const m = replyMessage(base);
    expect(m.tag).toBe(replyTag(A));
    expect(m.tag).not.toBe(clipTag(A));
    expect(m.key).toBe("c1");
    expect(m.url).toBe(coachThreadPath(A, "set1"));
    expect(m.title).toBe("Joey replied");
    expect(m.body).toBe("Felt the hips shoot up");
  });

  it("cuts a long reply to what a lock screen shows", () => {
    const m = replyMessage({ ...base, body: "word ".repeat(100) });
    expect(m.body.length).toBeLessThanOrEqual(140);
    expect(m.body.endsWith("…")).toBe(true);
  });
});

describe("the F26 thread route", () => {
  it("is one constant, F26's /coach/replies/<setId>, which marks read and redirects to the clip panel", () => {
    expect(COACH_THREAD_ROUTE).toBe("/coach/replies/:setId");
    expect(coachThreadPath(A, "set1")).toBe("/coach/replies/set1");
    expect(coachThreadPath(A, "set1")).not.toBe(coachClipPath(A, "set1"));
  });

  it("escapes what it is given", () => {
    expect(coachThreadPath(A, "c&d/e")).toBe("/coach/replies/c%26d%2Fe");
  });
});

describe("testMessage", () => {
  it("buzzes every time and lands back on the settings", () => {
    const a = testMessage(new Date(1));
    const b = testMessage(new Date(2));
    expect(a.key).not.toBe(b.key);
    expect(a.url).toBe("/me");
  });
});

describe("collapsedTitle", () => {
  it("counts clips and replies, and leaves a single one to its own title", () => {
    expect(collapsedTitle("clip", "Joey", 3)).toBe("Joey uploaded 3 clips");
    expect(collapsedTitle("reply", "Joey", 2)).toBe("Joey replied 2 times");
    expect(collapsedTitle("sick", "Joey", 3)).toBe("Joey called in sick 3 times");
    expect(collapsedTitle("sick", "Joey", 1)).toBe("");
    expect(collapsedTitle("clip", "Joey", 1)).toBe("");
    expect(collapsedTitle("test", "Joey", 4)).toBe("");
  });
});

describe("isAppPath", () => {
  it("allows only a path on this origin", () => {
    expect(isAppPath("/coach/review")).toBe(true);
    for (const bad of ["//evil.io/x", "https://evil.io", "javascript:alert(1)", "/\\evil.io", "", 7]) {
      expect(isAppPath(bad), String(bad)).toBe(false);
    }
  });
});
