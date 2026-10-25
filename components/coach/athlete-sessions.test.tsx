import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AthleteSessions } from "./athlete-sessions";
import type { HistorySet } from "@/lib/logging/history-store";
import type { SessionRecord } from "@/lib/logging/session";

/**
 * The coach's read of an athlete's sessions, for F11: the one place a coach
 * sees the athlete's note on a set that was never filmed.
 */

const sessions = vi.hoisted(() => ({ fetchRecentSessions: vi.fn() }));
vi.mock("@/lib/logging/session-store", () => sessions);

const library = vi.hoisted(() => ({ fetchExerciseLibrary: vi.fn() }));
vi.mock("@/lib/exercises/library", () => library);

const sets = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/logging/history-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/history-store")>()),
  fetchSetsForSessions: async () => sets.rows,
}));

const SESSION: SessionRecord = {
  id: "s1",
  clientSessionId: "s1",
  startedAt: new Date("2026-10-20T09:00:00Z"),
  finishedAt: new Date("2026-10-20T10:00:00Z"),
  setCount: 3,
  tonnageKg: 1500,
  notes: null,
};

const set = (over: Partial<HistorySet>): HistorySet => ({
  sessionId: "s1",
  exerciseId: "squat",
  clientSetId: "st",
  setIndex: 1,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  isWarmup: false,
  e1rmKg: null,
  loggedAt: new Date("2026-10-20T09:10:00Z"),
  ...over,
});

beforeEach(() => {
  sessions.fetchRecentSessions.mockResolvedValue([SESSION]);
  library.fetchExerciseLibrary.mockResolvedValue([
    { id: "squat", name: "Squat", normalisedName: "squat", isGlobal: true },
  ]);
  sets.rows = [
    set({ clientSetId: "w", setIndex: 1, loadKg: 60, isWarmup: true, rpe: null }),
    set({ clientSetId: "a", setIndex: 2 }),
    set({ clientSetId: "b", setIndex: 3, notes: "Left hip pinched, no video" }),
  ];
});

it("shows the athlete's note on an unfilmed set under its exercise, numbered as they number it", async () => {
  const user = userEvent.setup();
  render(<AthleteSessions athleteId="joey" />);
  await user.click(await screen.findByRole("button", { name: /Squat/ }));
  const notes = screen.getByRole("list", { name: "Athlete notes on Squat" });
  expect(within(notes).getAllByRole("listitem")).toHaveLength(1);
  // The warm-up does not count: this is the second working set.
  expect(notes).toHaveTextContent("Set 2 “Left hip pinched, no video”");
});

it("shows no notes list for an exercise nobody wrote about", async () => {
  sets.rows = [set({ clientSetId: "a" })];
  const user = userEvent.setup();
  render(<AthleteSessions athleteId="joey" />);
  await user.click(await screen.findByRole("button", { name: /Squat/ }));
  expect(screen.queryByRole("list", { name: /Athlete notes/ })).not.toBeInTheDocument();
});

it("marks a missed set Failed beside its numbers, so the coach never reads it as made (F19)", async () => {
  sets.rows = [set({ clientSetId: "a", loadKg: 180, reps: 3 }), set({ clientSetId: "b", setIndex: 2, loadKg: 200, reps: 0, rpe: 10, failed: true })];
  const user = userEvent.setup();
  render(<AthleteSessions athleteId="joey" />);
  await user.click(await screen.findByRole("button", { name: /Squat/ }));
  const marks = document.querySelectorAll("[data-failed]");
  expect(marks).toHaveLength(1);
  expect(marks[0].parentElement).toHaveTextContent("200 × 0 @10Failed");
});
