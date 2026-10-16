import { lastLoggedWeeks, setsInWords, waitingClips, type ContextSet } from "./editor-context";
import type { ClipSet } from "@/lib/review/queue";

const set = (over: Partial<ContextSet> & { at: string }): ContextSet => ({
  exerciseId: "squat",
  sessionId: "s1",
  setIndex: 0,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  isWarmup: false,
  loggedAt: new Date(over.at),
  ...over,
});

describe("the context drawer's last logged week", () => {
  it("writes sets the way a coach does, folding straight sets", () => {
    expect(
      setsInWords([
        { loadKg: 180, reps: 3, rpe: 8 },
        { loadKg: 165, reps: 5, rpe: 7.5 },
        { loadKg: 165, reps: 5, rpe: 7.5 },
        { loadKg: 165, reps: 5, rpe: 7.5 },
        { loadKg: 165, reps: 5, rpe: null },
      ]),
    ).toBe("180 × 3 @8, 165 × 5 @7.5 ×3, 165 × 5");
  });

  it("gives each exercise its own last week, every session of it that week, without warm-ups", () => {
    const sets = [
      // Squat: the week of 5 Oct (Mon) and, earlier, 28 Sep.
      set({ at: "2026-09-29T10:00:00", sessionId: "old", loadKg: 170 }),
      set({ at: "2026-10-06T10:00:00", sessionId: "tue", setIndex: 0, loadKg: 100, isWarmup: true }),
      set({ at: "2026-10-06T10:10:00", sessionId: "tue", setIndex: 1 }),
      set({ at: "2026-10-06T10:20:00", sessionId: "tue", setIndex: 2, loadKg: 165, reps: 5, rpe: 7 }),
      set({ at: "2026-10-09T10:00:00", sessionId: "fri", loadKg: 150, reps: 5, rpe: 6 }),
      // Bench: only in the week of 28 Sep.
      set({ at: "2026-09-30T10:00:00", sessionId: "old", exerciseId: "bench", loadKg: 110, reps: 5, rpe: 8 }),
    ];
    expect(lastLoggedWeeks(sets, ["squat", "bench", "deadlift"])).toEqual([
      {
        exerciseId: "squat",
        weekOf: "2026-10-05",
        sessions: [
          { day: "2026-10-06", sets: "180 × 3 @8, 165 × 5 @7" },
          { day: "2026-10-09", sets: "150 × 5 @6" },
        ],
      },
      { exerciseId: "bench", weekOf: "2026-09-28", sessions: [{ day: "2026-09-30", sets: "110 × 5 @8" }] },
    ]);
  });

  it("leaves out an exercise with only warm-ups logged", () => {
    expect(lastLoggedWeeks([set({ at: "2026-10-06T10:00:00", isWarmup: true })], ["squat"])).toEqual([]);
  });
});

describe("the context drawer's waiting clips", () => {
  const clip = (id: string, loggedAt: string): ClipSet => ({
    id,
    athleteId: "joey",
    exerciseId: "squat",
    sessionId: "s1",
    setIndex: 0,
    loadKg: 180,
    reps: 3,
    rpe: 8,
    e1rmKg: null,
    loggedAt,
    videoFileId: `f-${id}`,
    notes: null,
  });

  it("lists what this coach has not cleared, newest first, and counts all of it", () => {
    const clips = [clip("a", "2026-10-01T10:00:00Z"), clip("b", "2026-10-08T10:00:00Z"), clip("c", "2026-10-09T10:00:00Z")];
    const { total, rows } = waitingClips(clips, new Set(["c"]), () => "Squat", 1);
    expect(total).toBe(2);
    expect(rows.map((r) => [r.id, r.exerciseName])).toEqual([["b", "Squat"]]);
  });
});
