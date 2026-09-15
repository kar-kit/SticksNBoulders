import {
  buildQueue,
  e1rmDelta,
  firstItem,
  groupByAthlete,
  nextAfter,
  setPosition,
  type ClipSet,
} from "./queue";

const clip = (over: Partial<ClipSet> & Pick<ClipSet, "id">): ClipSet => ({
  athleteId: "joey",
  exerciseId: "squat",
  sessionId: "s1",
  setIndex: 0,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  e1rmKg: 200,
  loggedAt: "2026-09-10T10:00:00.000Z",
  videoFileId: "file1",
  notes: null,
  ...over,
});

const names = {
  athletes: new Map([
    ["joey", "Joey P"],
    ["sam", "Sam T"],
  ]),
  exercises: new Map([
    ["squat", "Back Squat"],
    ["dl", "Deadlift"],
  ]),
};

describe("buildQueue", () => {
  it("leaves out clips this coach has already cleared", () => {
    const queue = buildQueue(
      [clip({ id: "a" }), clip({ id: "b" }), clip({ id: "c" })],
      new Set(["b"]),
      names,
    );
    expect(queue.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("puts the longest wait first", () => {
    // The clip filmed on Tuesday is the one the athlete is still wondering
    // about, so it is the one the coach sees first.
    const queue = buildQueue(
      [
        clip({ id: "fri", loggedAt: "2026-09-11T09:00:00.000Z" }),
        clip({ id: "tue", loggedAt: "2026-09-08T09:00:00.000Z" }),
        clip({ id: "wed", loggedAt: "2026-09-09T09:00:00.000Z" }),
      ],
      new Set(),
      names,
    );
    expect(queue.map((item) => item.id)).toEqual(["tue", "wed", "fri"]);
  });

  it("orders ties by id rather than leaving them to the sort's whim", () => {
    // Sets logged offline in the same second share a timestamp, and a queue
    // that reshuffles between renders loses the coach's place.
    const same = "2026-09-08T09:00:00.000Z";
    const queue = buildQueue(
      [clip({ id: "b", loggedAt: same }), clip({ id: "a", loggedAt: same })],
      new Set(),
      names,
    );
    expect(queue.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("names each clip's athlete and lift", () => {
    const [item] = buildQueue([clip({ id: "a", athleteId: "sam", exerciseId: "dl" })], new Set(), names);
    expect(item.athleteName).toBe("Sam T");
    expect(item.exerciseName).toBe("Deadlift");
  });

  it("still shows a clip whose athlete has no profile yet", () => {
    // An athlete mid-onboarding has no profile row. Hiding their clip would
    // read to the coach as "they did not train".
    const [item] = buildQueue([clip({ id: "a", athleteId: "ghost" })], new Set(), names);
    expect(item.athleteName).toBe("Unnamed athlete");
  });

  it("sorts a clip with an unreadable date last instead of throwing the queue away", () => {
    const queue = buildQueue(
      [clip({ id: "bad", loggedAt: "not a date" }), clip({ id: "good" })],
      new Set(),
      names,
    );
    expect(queue.map((item) => item.id)).toEqual(["good", "bad"]);
  });
});

describe("groupByAthlete", () => {
  it("keeps each athlete once, in queue order", () => {
    const queue = buildQueue(
      [
        clip({ id: "1", athleteId: "sam", loggedAt: "2026-09-08T09:00:00.000Z" }),
        clip({ id: "2", athleteId: "joey", loggedAt: "2026-09-09T09:00:00.000Z" }),
        clip({ id: "3", athleteId: "sam", loggedAt: "2026-09-10T09:00:00.000Z" }),
      ],
      new Set(),
      names,
    );
    const groups = groupByAthlete(queue);
    expect(groups.map((group) => group.athleteId)).toEqual(["sam", "joey"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("is empty for an empty queue rather than a group with nothing in it", () => {
    expect(groupByAthlete([])).toEqual([]);
  });
});

describe("nextAfter", () => {
  const queue = buildQueue(
    [
      clip({ id: "a", loggedAt: "2026-09-08T09:00:00.000Z" }),
      clip({ id: "b", loggedAt: "2026-09-09T09:00:00.000Z" }),
      clip({ id: "c", loggedAt: "2026-09-10T09:00:00.000Z" }),
    ],
    new Set(),
    names,
  );

  it("advances to the following clip", () => {
    expect(nextAfter(queue, "b")?.id).toBe("c");
  });

  it("falls back to the previous clip at the end of the list", () => {
    // Clearing the last one must not snap the coach back to the top, and must
    // never land on the clip they just cleared.
    expect(nextAfter(queue, "c")?.id).toBe("b");
  });

  it("returns null when the queue held only that clip", () => {
    const single = buildQueue([clip({ id: "only" })], new Set(), names);
    expect(nextAfter(single, "only")).toBeNull();
  });

  it("starts at the top when the id is not in the queue", () => {
    expect(nextAfter(queue, "gone")?.id).toBe("a");
  });

  it("returns null for an empty queue", () => {
    expect(nextAfter([], "anything")).toBeNull();
    expect(firstItem([])).toBeNull();
  });
});

describe("setPosition", () => {
  const sessionSets = [
    { exerciseId: "squat", setIndex: 0 },
    { exerciseId: "squat", setIndex: 1 },
    { exerciseId: "bench", setIndex: 0 },
    { exerciseId: "squat", setIndex: 2 },
    { exerciseId: "squat", setIndex: 3 },
  ];

  it("counts within the lift, not across the whole session", () => {
    // "set 3 of 4" means the third squat, not the third row of the workout.
    expect(setPosition(clip({ id: "a", setIndex: 2 }), sessionSets)).toEqual({ position: 3, total: 4 });
  });

  it("reads the first set as 1 of 4", () => {
    expect(setPosition(clip({ id: "a", setIndex: 0 }), sessionSets)).toEqual({ position: 1, total: 4 });
  });

  it("falls back to 1 of 1 when the session's sets could not be read", () => {
    expect(setPosition(clip({ id: "a" }), [])).toEqual({ position: 1, total: 1 });
  });

  it("does not claim set 0 when the clip is missing from its own session", () => {
    expect(setPosition(clip({ id: "a", setIndex: 9 }), sessionSets).position).toBe(1);
  });
});

describe("e1rmDelta", () => {
  it("reports the gain on their previous best", () => {
    expect(e1rmDelta(clip({ id: "a", e1rmKg: 212.5 }), 210)).toEqual({ e1rmKg: 212.5, deltaKg: 2.5 });
  });

  it("reports a drop as a drop rather than hiding it", () => {
    expect(e1rmDelta(clip({ id: "a", e1rmKg: 205 }), 210)?.deltaKg).toBe(-5);
  });

  it("gives no delta on a lift with no history", () => {
    // Rendered as "first on this lift". A "+0.0" would read as a plateau.
    expect(e1rmDelta(clip({ id: "a", e1rmKg: 200 }), null)).toEqual({ e1rmKg: 200, deltaKg: null });
  });

  it("is null when the set itself has no estimate", () => {
    expect(e1rmDelta(clip({ id: "a", e1rmKg: null }), 210)).toBeNull();
    expect(e1rmDelta(clip({ id: "a", e1rmKg: 0 }), 210)).toBeNull();
  });
});
