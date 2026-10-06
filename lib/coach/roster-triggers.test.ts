import { KIND_ORDER, needsYou, TRIGGER_RULES, type AthleteSignals, type ProgramSignals } from "./roster-triggers";

// A Tuesday afternoon in London.
const NOW = new Date("2026-10-06T14:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const dayKeyAgo = (n: number) => {
  const d = daysAgo(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const athlete = (over: Partial<AthleteSignals> = {}): AthleteSignals => ({
  athleteId: "joey",
  name: "Joey Pang",
  visible: true,
  linkedAt: daysAgo(60),
  unreviewedClips: 0,
  lastBodyweightOn: dayKeyAgo(1),
  program: null,
  ...over,
});

const program = (over: Partial<ProgramSignals> = {}): ProgramSignals => ({
  blockLabel: "Week 3 of 8",
  missedSessions: 0,
  unpromptedMaxes: [],
  ...over,
});

const kinds = (a: AthleteSignals) => needsYou([a], NOW).map((i) => i.kind);

describe("nothing needs you", () => {
  it("is empty for an athlete who is on top of everything", () => {
    expect(needsYou([athlete()], NOW)).toEqual([]);
  });

  it("is empty with no athletes", () => {
    expect(needsYou([], NOW)).toEqual([]);
  });
});

describe("videos [Inference: any one clip, any age]", () => {
  it("fires on one unreviewed clip and links to the queue", () => {
    const [item] = needsYou([athlete({ unreviewedClips: 1 })], NOW);
    expect(item).toMatchObject({ kind: "videos", text: "1 video waiting", href: "/coach/review" });
  });

  it("counts plurally", () => {
    expect(needsYou([athlete({ unreviewedClips: 3 })], NOW)[0].text).toBe("3 videos waiting");
  });

  it("follows the threshold rather than a literal", () => {
    expect(needsYou([athlete({ unreviewedClips: 1 })], NOW, { ...TRIGGER_RULES, videosMin: 2 })).toEqual([]);
  });
});

describe("no bodyweight [Inference: over 7 days, never-logged after a grace period]", () => {
  it("is quiet at exactly the gap", () => {
    expect(kinds(athlete({ lastBodyweightOn: dayKeyAgo(TRIGGER_RULES.bodyweightGapDays) }))).toEqual([]);
  });

  it("fires the day after, naming the gap, and links to the athlete", () => {
    const [item] = needsYou([athlete({ lastBodyweightOn: dayKeyAgo(8) })], NOW);
    expect(item).toMatchObject({ kind: "no-bodyweight", text: "no bodyweight in 8 days", href: "/coach/athletes/joey" });
  });

  it("gives a just-linked athlete who never weighed in a grace period", () => {
    expect(kinds(athlete({ lastBodyweightOn: null, linkedAt: daysAgo(3) }))).toEqual([]);
  });

  it("fires for a never-logged athlete once the grace period is up", () => {
    const [item] = needsYou([athlete({ lastBodyweightOn: null, linkedAt: daysAgo(10) })], NOW);
    expect(item.text).toBe("no bodyweight logged yet");
  });

  it("stays quiet about a never-logged athlete with no link date", () => {
    expect(kinds(athlete({ lastBodyweightOn: null, linkedAt: null }))).toEqual([]);
  });

  it("ignores an unreadable day rather than guessing", () => {
    expect(kinds(athlete({ lastBodyweightOn: "2026-13-45" }))).toEqual([]);
  });
});

describe("program-dependent triggers (Order 19 seam)", () => {
  it("are silent while there is no program", () => {
    expect(kinds(athlete({ program: null }))).toEqual([]);
  });

  it("missed sessions fire at the threshold [Inference: one is enough]", () => {
    const [item] = needsYou([athlete({ program: program({ missedSessions: 1 }) })], NOW);
    expect(item).toMatchObject({ kind: "missed-sessions", text: "missed 1 session this week" });
    expect(kinds(athlete({ program: program({ missedSessions: 0 }) }))).toEqual([]);
  });

  it("an unprompted RPE 10 fires inside the window [Inference: 7 days]", () => {
    const unprompted = [{ setId: "s1", loggedAt: daysAgo(2).toISOString(), prescribedRpe: 8 }];
    const [item] = needsYou([athlete({ program: program({ unpromptedMaxes: unprompted }) })], NOW);
    expect(item).toMatchObject({ kind: "unprompted-max", href: "/coach/athletes/joey" });
    expect(item.text).toBe("logged 1 set at RPE 10 that wasn't prescribed that hard");
  });

  it("and drops off after it", () => {
    const old = [{ setId: "s1", loggedAt: daysAgo(8).toISOString(), prescribedRpe: 8 }];
    expect(kinds(athlete({ program: program({ unpromptedMaxes: old }) }))).toEqual([]);
  });

  it("ignores a set with an unreadable time", () => {
    const bad = [{ setId: "s1", loggedAt: "not a date", prescribedRpe: 8 }];
    expect(kinds(athlete({ program: program({ unpromptedMaxes: bad }) }))).toEqual([]);
  });
});

describe("visibility", () => {
  it("fires nothing for an athlete whose circle the coach cannot see yet", () => {
    // Every read came back empty; none of that is a fact about the athlete.
    expect(kinds(athlete({ visible: false, unreviewedClips: 4, lastBodyweightOn: null }))).toEqual([]);
  });
});

describe("ordering [Inference: urgency]", () => {
  it("groups by kind in KIND_ORDER, then by name", () => {
    const items = needsYou(
      [
        athlete({ athleteId: "b", name: "Bea", unreviewedClips: 1, lastBodyweightOn: dayKeyAgo(9) }),
        athlete({ athleteId: "a", name: "Al", unreviewedClips: 2 }),
        athlete({
          athleteId: "c",
          name: "Cy",
          program: program({
            missedSessions: 2,
            unpromptedMaxes: [{ setId: "x", loggedAt: daysAgo(1).toISOString(), prescribedRpe: 8 }],
          }),
        }),
      ],
      NOW,
    );
    expect(items.map((i) => `${i.kind}:${i.athleteName}`)).toEqual([
      "unprompted-max:Cy",
      "missed-sessions:Cy",
      "videos:Al",
      "videos:Bea",
      "no-bodyweight:Bea",
    ]);
  });

  it("orders unprompted maxes first, as Ruairi's named complaint", () => {
    expect(KIND_ORDER[0]).toBe("unprompted-max");
  });
});
