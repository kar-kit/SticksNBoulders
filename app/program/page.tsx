"use client";

import { useEffect, useState } from "react";
import { Query } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES } from "@/lib/constants";
import type { Lift, Program, ProgramEntry } from "@/lib/types";
import { displayWeight } from "@/lib/units";
import PageSpinner from "@/components/PageSpinner";

export default function MyProgramPage() {
  const { user, profile, loading } = useRequireAuth();
  const [program, setProgram] = useState<Program | null | undefined>(undefined);
  const [entries, setEntries] = useState<ProgramEntry[]>([]);
  const [lifts, setLifts] = useState<Map<string, Lift>>(new Map());

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [programs, liftRows] = await Promise.all([
        tablesDB.listRows<Program>(DATABASE_ID, TABLES.programs, [
          Query.equal("athleteUserId", user.$id),
          Query.equal("active", true),
          Query.limit(1),
        ]),
        tablesDB.listRows<Lift>(DATABASE_ID, TABLES.lifts),
      ]);
      setLifts(new Map(liftRows.rows.map((l) => [l.$id, l])));
      const current = programs.rows[0] ?? null;
      setProgram(current);
      if (current) {
        const entryRows = await tablesDB.listRows<ProgramEntry>(DATABASE_ID, TABLES.programEntries, [
          Query.equal("programId", current.$id),
        ]);
        setEntries(entryRows.rows);
      }
    })();
  }, [user]);

  if (loading || !profile || program === undefined) return <PageSpinner />;

  if (!program) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-safe-8 pb-8">
        <h1 className="text-xl font-semibold">My Program</h1>
        <p className="text-sm text-muted">
          You don&apos;t have a program assigned. Link with a coach from Profile to get one.
        </p>
      </div>
    );
  }

  const byDay = new Map<string, ProgramEntry[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.dayLabel) ?? [];
    list.push(entry);
    byDay.set(entry.dayLabel, list);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <h1 className="text-xl font-semibold">{program.name}</h1>

      {[...byDay.entries()].map(([dayLabel, dayEntries]) => (
        <section key={dayLabel} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">{dayLabel}</h2>
          {dayEntries.map((entry) => (
            <div key={entry.$id} className="rounded-xl bg-surface px-4 py-3 text-sm">
              <p className="font-medium">{lifts.get(entry.liftId)?.name ?? "Lift"}</p>
              <p className="text-xs text-muted">
                {entry.targetSets} sets × {entry.targetReps} reps
                {entry.targetLoadKg
                  ? ` @ ${displayWeight(entry.targetLoadKg, profile.unitPreference)} ${profile.unitPreference}`
                  : entry.targetPercent1RM
                    ? ` @ ${entry.targetPercent1RM}% 1RM`
                    : ""}
              </p>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
