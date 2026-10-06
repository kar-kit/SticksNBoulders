"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldLabel, TextField } from "@/components/ui/input";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { useSession } from "@/lib/auth/session-context";
import { addDays, localDay, type Program } from "@/lib/programming/program";
import { fetchPrograms, sendProgramOp } from "@/lib/programming/program-store";

/**
 * Programs, the coach's index. Order 19.
 *
 * One row per athlete the coach can program for -- every active link, plus the
 * coach themselves, because a coach is usually also an athlete -- with the
 * programs written for them underneath. Starting a block is a name and a start
 * date; the editor takes it from there.
 *
 * Templates are not offered. The tables already hold them (a program with no
 * athlete), but whether Ruairi reuses a skeleton across athletes is still
 * question 6/7 for him, and the blueprint keeps them out of the MVP.
 */

interface Person {
  id: string;
  name: string;
}

/** The Monday on or after today: blocks start on a Monday more often than not. */
export function nextMonday(today: string = localDay()): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, (8 - weekday) % 7);
}

const STATUS_LABEL: Record<Program["status"], string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function ProgramList() {
  const { state } = useSession();
  const router = useRouter();
  const coachId = state.status === "signed-in" ? state.user.id : null;
  const athleteIds = state.status === "signed-in" ? state.coach.athleteIds : null;
  const [people, setPeople] = useState<Person[]>([]);
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    if (!coachId || !athleteIds) return;
    let cancelled = false;
    void (async () => {
      const [names, mine] = await Promise.all([
        athleteIds.length > 0 ? fetchAthleteNames(athleteIds).catch(() => []) : Promise.resolve([]),
        fetchPrograms({ coachId }).catch(() => null),
      ]);
      if (cancelled) return;
      // An athlete whose name could not be read is still someone to program for.
      const named = new Map(names.map((n) => [n.id, n.name]));
      setPeople([
        ...athleteIds.map((id) => ({ id, name: named.get(id) ?? "Athlete" })),
        { id: coachId, name: "Yourself" },
      ]);
      if (mine) setPrograms(mine);
      else setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [coachId, athleteIds]);

  if (!coachId) return null;

  if (failed) {
    return (
      <Centered>
        <EmptyState title="Programs did not load" body="Nothing was changed. Reload to try again." />
      </Centered>
    );
  }

  if (programs === null) return <div className="p-8" aria-busy />;

  const create = async (athleteId: string, name: string, startOn: string) => {
    // Program, its first block and first week in one go, so the editor opens
    // on a grid to type into rather than three empty containers.
    const { rowId: programId } = await sendProgramOp({ op: "createProgram", athleteId, name, startOn });
    const { rowId: blockId } = await sendProgramOp({ op: "addBlock", programId, name: "Block 1" });
    await sendProgramOp({ op: "addWeek", blockId });
    router.push(`/coach/programs/${programId}`);
  };

  return (
    <div className="flex flex-col gap-8 p-8">
      <h1 className="m-0 text-display font-semibold">Programs</h1>
      {people.length === 1 ? (
        <p className="m-0 text-body text-muted">
          No athletes linked yet. Share your invite code from your profile; you can still write your own training below.
        </p>
      ) : null}
      {people.map((person) => {
        const theirs = programs.filter((p) => p.athleteId === person.id);
        return (
          <section key={person.id} aria-label={person.name} className="flex flex-col gap-3">
            <header className="flex items-center justify-between gap-3">
              <h2 className="m-0 text-title font-semibold">{person.name}</h2>
              {creating === person.id ? null : (
                <Button variant="secondary" size="sm" onClick={() => setCreating(person.id)}>
                  New block
                </Button>
              )}
            </header>
            {creating === person.id ? (
              <NewProgramForm
                onCancel={() => setCreating(null)}
                onCreate={(name, startOn) => create(person.id, name, startOn)}
              />
            ) : null}
            {theirs.length === 0 && creating !== person.id ? (
              <p className="m-0 text-ui text-muted">Nothing written yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {theirs.map((program) => (
                  <li key={program.id}>
                    <Link
                      href={`/coach/programs/${program.id}`}
                      className="flex items-center justify-between rounded-control border border-border bg-surface px-4 py-3 text-body"
                    >
                      <span className="font-semibold">{program.name}</span>
                      <span className="text-ui text-muted">
                        {STATUS_LABEL[program.status]}
                        {program.startOn ? ` · from ${program.startOn}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function NewProgramForm({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string, startOn: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [startOn, setStartOn] = useState(nextMonday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim()) return setError("Give the block a name.");
        setBusy(true);
        setError(null);
        try {
          await onCreate(name.trim(), startOn);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "Could not create it. Nothing was saved.");
          setBusy(false);
        }
      }}
    >
      <div className="flex min-w-64 flex-1 flex-col gap-1">
        <FieldLabel htmlFor="new-program-name">Name</FieldLabel>
        <TextField
          id="new-program-name"
          autoFocus
          value={name}
          placeholder="Hypertrophy block, Oct–Nov"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="new-program-start">Starts</FieldLabel>
        <TextField id="new-program-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create"}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      {error ? (
        <p role="alert" className="m-0 w-full text-ui text-danger-line">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-8">{children}</div>;
}
