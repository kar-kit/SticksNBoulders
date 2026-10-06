import { parsePrescription } from "@/lib/programming/prescription";
import { addDays, byPosition, type Program, type ProgramDay, type ProgramWeek } from "@/lib/programming/program";
import type { ProgramSignals } from "./roster-triggers";

/**
 * What the program says about each athlete on the Roster (Order 24's seam,
 * filled by Order 19). Pure: the store reads the rows, this decides.
 *
 * - **Block column**: "Week 3 of 8" for the athlete's live program -- the most
 *   recently updated published one, the same choice Today makes when two
 *   overlap. "Starts 13 Oct" before its first day, "Block finished" after its
 *   last.
 * - **Missed sessions**: [Inference] published days this calendar week
 *   (Monday on) whose date is before today and that no session was started
 *   from. A session logged with "Log something else" on that day does not
 *   count as doing it -- the link is `sessions.program_day_id`.
 * - **Unprompted maxes**: working sets at RPE 10 answering a line whose RPE
 *   (an RPE line, or the cap on a capped one) was below 10. A line with no RPE
 *   at all (fixed or bare percentage) never fires: nothing said how hard.
 */

export interface SignalInputs {
  programs: readonly Program[];
  weeks: readonly ProgramWeek[];
  days: readonly ProgramDay[];
  /** Sessions in the window, with the day they were started from. */
  sessions: readonly { athleteId: string; programDayId: string | null }[];
  /** Recent RPE-10 working sets that answered a prescription. */
  maxedSets: readonly { id: string; athleteId: string; loggedAt: string; prescriptionId: string }[];
  /** The load cell of each line those sets answered, by id. */
  lineLoads: ReadonlyMap<string, string | null>;
}

const monday = (today: string) => addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));

const short = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The RPE a load cell asks for, or null when it names none. */
export function prescribedRpe(load: string | null): number | null {
  const spec = load ? parsePrescription(load) : null;
  return spec && (spec.kind === "rpe" || spec.kind === "capped") ? spec.rpe : null;
}

export function computeProgramSignals(
  athleteIds: readonly string[],
  input: SignalInputs,
  today: string,
): Map<string, ProgramSignals> {
  const result = new Map<string, ProgramSignals>();
  const from = monday(today);
  const started = new Set(input.sessions.map((s) => s.programDayId).filter((id): id is string => Boolean(id)));

  for (const athleteId of athleteIds) {
    const live = input.programs
      .filter((p) => p.athleteId === athleteId && p.status === "published")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

    const maxed = input.maxedSets
      .filter((set) => set.athleteId === athleteId)
      .map((set) => ({ set, rpe: prescribedRpe(input.lineLoads.get(set.prescriptionId) ?? null) }))
      .filter(({ rpe }) => rpe !== null && rpe < 10)
      .map(({ set, rpe }) => ({ setId: set.id, loggedAt: set.loggedAt, prescribedRpe: rpe }));

    if (!live) {
      if (maxed.length > 0) result.set(athleteId, { blockLabel: null, missedSessions: 0, unpromptedMaxes: maxed });
      continue;
    }

    const weeks = byPosition(input.weeks.filter((w) => w.programId === live.id && w.status === "published"));
    const published = new Set(weeks.map((w) => w.id));
    const days = input.days.filter((d) => d.programId === live.id && published.has(d.weekId) && d.scheduledOn);

    const done = days.filter((d) => d.scheduledOn! <= today).sort((a, b) => a.scheduledOn!.localeCompare(b.scheduledOn!));
    const last = [...days].sort((a, b) => b.scheduledOn!.localeCompare(a.scheduledOn!))[0];
    let blockLabel: string | null = null;
    if (weeks.length > 0 && days.length > 0) {
      if (done.length === 0) {
        blockLabel = `Starts ${short([...days].sort((a, b) => a.scheduledOn!.localeCompare(b.scheduledOn!))[0].scheduledOn!)}`;
      } else if (last.scheduledOn! < today) {
        blockLabel = "Block finished";
      } else {
        const current = weeks.findIndex((w) => w.id === done.at(-1)!.weekId) + 1;
        blockLabel = `Week ${current} of ${weeks.length}`;
      }
    }

    const missedSessions = days.filter(
      (d) => d.scheduledOn! >= from && d.scheduledOn! < today && !started.has(d.id),
    ).length;

    result.set(athleteId, { blockLabel, missedSessions, unpromptedMaxes: maxed });
  }
  return result;
}
