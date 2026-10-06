import { addDays, type ProgramOpInput } from "./program";

/**
 * A realistic block, written as data, for the seed script and the e2e.
 *
 * There is no Program Editor yet -- it is blocked on how Ruairi writes a block
 * -- so this is how a program gets into the database meanwhile. It goes in
 * through the same ops the editor will send, one validated write at a time,
 * so a seeded program is exactly as valid as an edited one.
 *
 * [Inference] The content is a plausible four-week volume block in the RTS
 * style -- an RPE top set, percentage backoffs priced off it, then
 * accessories -- written to exercise every prescription kind in one session:
 * RPE, percent, capped, fixed and freeform. It is not Ruairi's programming
 * and should not be read as a recommendation.
 */

export const SAMPLE_EXERCISES = [
  "Squat",
  "Bench Press",
  "Deadlift",
  "Pause Squat",
  "Close Grip Bench Press",
  "Romanian Deadlift",
  "Front Squat",
  "Leg Press",
] as const;
export type SampleExercise = (typeof SAMPLE_EXERCISES)[number];

export interface OutlineLine {
  exercise: SampleExercise;
  setCount: number;
  reps: number | null;
  repMax?: number | null;
  load: string | null;
  restSeconds?: number | null;
  notes?: string | null;
}
export interface OutlineDay {
  label: string;
  scheduledOn: string | null;
  notes?: string | null;
  lines: OutlineLine[];
}
export interface OutlineWeek {
  label: string;
  status: "draft" | "published";
  days: OutlineDay[];
}
export interface ProgramOutline {
  name: string;
  notes: string | null;
  startOn: string | null;
  blocks: Array<{ name: string; notes?: string | null; weeks: OutlineWeek[] }>;
}

/** Week-on-week backoff percentages: three build weeks and a deload. */
const WEEKS = [
  { backoff: 75, bench: 72.5, label: "Week 1" },
  { backoff: 77.5, bench: 75, label: "Week 2" },
  { backoff: 80, bench: 77.5, label: "Week 3" },
  { backoff: 65, bench: 62.5, label: "Week 4 · deload" },
];

/**
 * The sample block, starting on `startOn`.
 *
 * Three sessions a week, two days apart, so day 1 is `startOn` itself -- which
 * is what lets the e2e and a fresh seed open Today on a prescribed session.
 * Weeks 1 and 2 are published and weeks 3 and 4 are drafts: the per-week
 * status is the part of the model that makes week-by-week writing possible,
 * so the sample shows it.
 */
export function sampleProgram(startOn: string, options: { publishedWeeks?: number } = {}): ProgramOutline {
  const published = options.publishedWeeks ?? 2;
  return {
    name: "Sample block — volume",
    notes: "Seeded sample. Not written by a coach.",
    startOn,
    blocks: [
      {
        name: "Volume",
        notes: "Top set by feel, backoffs priced off it.",
        weeks: WEEKS.map((week, w) => {
          const on = (offset: number) => addDays(startOn, w * 7 + offset);
          const deload = w === WEEKS.length - 1;
          return {
            label: week.label,
            status: w < published ? "published" : "draft",
            days: [
              {
                label: `${week.label} · Day 1 — squat`,
                scheduledOn: on(0),
                notes:
                  w === 0
                    ? "First week back after the test. Keep the top set honest: if the bar speed is not there, stop at 7."
                    : null,
                lines: [
                  { exercise: "Squat", setCount: 1, reps: 5, load: deload ? "@6" : "@8", restSeconds: 240 },
                  { exercise: "Squat", setCount: 3, reps: 5, load: `${week.backoff}%`, restSeconds: 180 },
                  { exercise: "Bench Press", setCount: 4, reps: 6, load: `${week.bench}% @8`, restSeconds: 150 },
                  {
                    exercise: "Romanian Deadlift",
                    setCount: 3,
                    reps: 8,
                    repMax: 10,
                    load: "moderate, 2 in the tank",
                  },
                ],
              },
              {
                label: `${week.label} · Day 2 — bench`,
                scheduledOn: on(2),
                lines: [
                  { exercise: "Bench Press", setCount: 1, reps: 4, load: deload ? "@6" : "@8", restSeconds: 180 },
                  { exercise: "Bench Press", setCount: 4, reps: 4, load: `${week.backoff}%`, restSeconds: 150 },
                  { exercise: "Pause Squat", setCount: 3, reps: 4, load: deload ? "80kg" : "100kg", notes: "2s pause" },
                  { exercise: "Close Grip Bench Press", setCount: 3, reps: 8, load: "@7" },
                ],
              },
              {
                label: `${week.label} · Day 3 — deadlift`,
                scheduledOn: on(4),
                lines: [
                  { exercise: "Deadlift", setCount: 1, reps: 3, load: deload ? "@6" : "@8", restSeconds: 240 },
                  { exercise: "Deadlift", setCount: 3, reps: 3, load: `${week.backoff}%`, restSeconds: 180 },
                  { exercise: "Front Squat", setCount: 3, reps: 5, load: "@7" },
                  { exercise: "Leg Press", setCount: 3, reps: 12, load: "last set to failure" },
                ],
              },
            ],
          };
        }),
      },
    ],
  };
}

export interface WrittenProgram {
  programId: string;
  /** Every row id written, in creation order, table by table. */
  rows: { table: "programs" | "program_blocks" | "program_weeks" | "program_days" | "prescriptions"; id: string }[];
  /** Day ids by scheduled date, for a caller that wants "today's". */
  daysOn: Map<string, string>;
}

/**
 * Writes an outline through the program ops, top down.
 *
 * `run` sends one op and answers with the row id -- the route from a browser,
 * `runProgramOp` from a script. So the seed goes through the same validation
 * and the same authorisation as the editor will, rather than around them.
 */
export async function writeOutline(
  run: (op: ProgramOpInput) => Promise<string>,
  athleteId: string | null,
  outline: ProgramOutline,
  exerciseIds: Readonly<Record<SampleExercise, string>>,
): Promise<WrittenProgram> {
  const rows: WrittenProgram["rows"] = [];
  const daysOn = new Map<string, string>();

  // Draft while it is being written, published once it is whole, so no
  // athlete ever loads a half-seeded block.
  const programId = await run({
    op: "createProgram",
    athleteId,
    name: outline.name,
    notes: outline.notes,
    startOn: athleteId ? outline.startOn : null,
    status: "draft",
  });
  rows.push({ table: "programs", id: programId });

  for (const block of outline.blocks) {
    const blockId = await run({ op: "addBlock", programId, name: block.name, notes: block.notes ?? null });
    rows.push({ table: "program_blocks", id: blockId });
    for (const week of block.weeks) {
      const weekId = await run({ op: "addWeek", blockId, label: week.label, status: week.status });
      rows.push({ table: "program_weeks", id: weekId });
      for (const day of week.days) {
        const scheduledOn = athleteId ? day.scheduledOn : null;
        const dayId = await run({ op: "addDay", weekId, label: day.label, scheduledOn, notes: day.notes ?? null });
        rows.push({ table: "program_days", id: dayId });
        if (scheduledOn) daysOn.set(scheduledOn, dayId);
        for (const line of day.lines) {
          const id = await run({
            op: "addPrescription",
            dayId,
            exerciseId: exerciseIds[line.exercise],
            setCount: line.setCount,
            reps: line.reps,
            repMax: line.repMax ?? null,
            load: line.load,
            restSeconds: line.restSeconds ?? null,
            notes: line.notes ?? null,
          });
          rows.push({ table: "prescriptions", id });
        }
      }
    }
  }

  await run({ op: "updateProgram", programId, status: "published" });
  return { programId, rows, daysOn };
}
