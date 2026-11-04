import {
  COACH_REVIEW_PATH,
  COACH_THREAD_ROUTE,
  coachClipPath,
  coachThreadPath,
  isAppPath,
} from "./links";
import { UNNAMED_ATHLETE, clipMessage, clipTag, collapsedTitle, replyMessage, replyTag, testMessage } from "./message";

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
  it("is one constant, pointing at the existing clip-and-thread panel until F26 lands", () => {
    expect(COACH_THREAD_ROUTE).toContain(":athleteId");
    expect(COACH_THREAD_ROUTE).toContain(":setId");
    expect(coachThreadPath(A, "set1")).toBe(coachClipPath(A, "set1"));
  });

  it("escapes what it is given", () => {
    expect(coachThreadPath("a/b", "c&d")).toBe("/coach/athletes/a%2Fb?clip=c%26d");
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
