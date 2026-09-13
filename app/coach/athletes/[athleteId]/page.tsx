"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ID, Query } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES } from "@/lib/constants";
import { getProgramPermissions } from "@/lib/permissions";
import type { CoachLink, Lift, Program, ProgramEntry } from "@/lib/types";
import PageSpinner from "@/components/PageSpinner";

export default function ProgramEditorPage({
  params,
}: {
  params: Promise<{ athleteId: string }>;
}) {
  const { athleteId } = use(params);
  const { user, profile, loading } = useRequireAuth();

  const [link, setLink] = useState<CoachLink | null | undefined>(undefined);
  const [program, setProgram] = useState<Program | null>(null);
  const [programChecked, setProgramChecked] = useState(false);
  const [entries, setEntries] = useState<ProgramEntry[]>([]);
  const [lifts, setLifts] = useState<Lift[]>([]);
  const [programName, setProgramName] = useState("");

  const [liftId, setLiftId] = useState("");
  const [dayLabel, setDayLabel] = useState("");
  const [targetSets, setTargetSets] = useState("3");
  const [targetReps, setTargetReps] = useState("5");
  const [targetLoadKg, setTargetLoadKg] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshProgram(coachUserId: string) {
    const programs = await tablesDB.listRows<Program>(DATABASE_ID, TABLES.programs, [
      Query.equal("athleteUserId", athleteId),
      Query.equal("coachUserId", coachUserId),
      Query.equal("active", true),
      Query.limit(1),
    ]);
    const current = programs.rows[0] ?? null;
    setProgram(current);
    if (current) {
      const entryRows = await tablesDB.listRows<ProgramEntry>(DATABASE_ID, TABLES.programEntries, [
        Query.equal("programId", current.$id),
      ]);
      setEntries(entryRows.rows);
    }
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [links, liftRows] = await Promise.all([
        tablesDB.listRows<CoachLink>(DATABASE_ID, TABLES.coachLinks, [
          Query.equal("coachUserId", user.$id),
          Query.equal("athleteUserId", athleteId),
          Query.equal("status", "active"),
          Query.limit(1),
        ]),
        tablesDB.listRows<Lift>(DATABASE_ID, TABLES.lifts),
      ]);
      setLifts(liftRows.rows);
      setLiftId(liftRows.rows[0]?.$id ?? "");
      const foundLink = links.rows[0] ?? null;
      setLink(foundLink);
      if (foundLink) await refreshProgram(user.$id);
      setProgramChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, athleteId]);

  if (loading || !profile || link === undefined) return <PageSpinner />;

  if (!link) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-safe-8 pb-8">
        <Link href="/coach" className="text-sm text-accent">
          ← Coach Dashboard
        </Link>
        <p className="text-sm text-muted">This athlete isn&apos;t linked to you.</p>
      </div>
    );
  }

  async function createProgram() {
    if (!programName.trim()) return;
    setBusy(true);
    try {
      const row = await tablesDB.createRow<Program>(
        DATABASE_ID,
        TABLES.programs,
        ID.unique(),
        { athleteUserId: athleteId, coachUserId: user!.$id, name: programName.trim(), active: true },
        getProgramPermissions(user!.$id, athleteId)
      );
      setProgram(row);
      setProgramName("");
    } finally {
      setBusy(false);
    }
  }

  async function addEntry() {
    if (!program || !liftId || !dayLabel.trim()) return;
    setBusy(true);
    try {
      const row = await tablesDB.createRow<ProgramEntry>(
        DATABASE_ID,
        TABLES.programEntries,
        ID.unique(),
        {
          programId: program.$id,
          liftId,
          targetSets: parseInt(targetSets, 10) || 1,
          targetReps: parseInt(targetReps, 10) || 1,
          targetLoadKg: targetLoadKg ? parseFloat(targetLoadKg) : null,
          targetPercent1RM: null,
          dayLabel: dayLabel.trim(),
        },
        getProgramPermissions(user!.$id, athleteId)
      );
      setEntries((prev) => [...prev, row]);
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entryId: string) {
    await tablesDB.deleteRow(DATABASE_ID, TABLES.programEntries, entryId);
    setEntries((prev) => prev.filter((e) => e.$id !== entryId));
  }

  const liftName = (id: string) => lifts.find((l) => l.$id === id)?.name ?? "";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <Link href="/coach" className="text-sm text-accent">
        ← Coach Dashboard
      </Link>
      <h1 className="text-xl font-semibold">{link.athleteName || "Athlete"}&apos;s program</h1>

      {!programChecked ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !program ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <span className="text-sm font-medium text-muted">No active program yet</span>
          <div className="flex gap-2">
            <input
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              placeholder="Program name"
              className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={createProgram}
              disabled={busy}
              className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60"
            >
              Create
            </button>
          </div>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted">{program.name}</h2>
            {entries.length === 0 ? (
              <p className="text-sm text-muted">No entries yet.</p>
            ) : (
              entries.map((entry) => (
                <div
                  key={entry.$id}
                  className="flex items-center justify-between rounded-xl bg-surface px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {entry.dayLabel} · {liftName(entry.liftId)}
                    </p>
                    <p className="text-xs text-muted">
                      {entry.targetSets} × {entry.targetReps}
                      {entry.targetLoadKg ? ` @ ${entry.targetLoadKg}kg` : ""}
                    </p>
                  </div>
                  <button onClick={() => removeEntry(entry.$id)} className="text-xs text-danger">
                    Remove
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
            <span className="text-sm font-medium text-muted">Add entry</span>
            <input
              value={dayLabel}
              onChange={(e) => setDayLabel(e.target.value)}
              placeholder="Day label, e.g. Day 1"
              className="h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
            />
            <select
              value={liftId}
              onChange={(e) => setLiftId(e.target.value)}
              className="h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
            >
              {lifts.map((lift) => (
                <option key={lift.$id} value={lift.$id}>
                  {lift.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                value={targetSets}
                onChange={(e) => setTargetSets(e.target.value)}
                placeholder="Sets"
                inputMode="numeric"
                className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              />
              <input
                value={targetReps}
                onChange={(e) => setTargetReps(e.target.value)}
                placeholder="Reps"
                inputMode="numeric"
                className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              />
              <input
                value={targetLoadKg}
                onChange={(e) => setTargetLoadKg(e.target.value)}
                placeholder="kg (optional)"
                inputMode="decimal"
                className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={addEntry}
              disabled={busy}
              className="h-11 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-60"
            >
              Add entry
            </button>
          </section>
        </>
      )}
    </div>
  );
}
