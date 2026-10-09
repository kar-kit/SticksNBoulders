"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextField } from "@/components/ui/input";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { useSession } from "@/lib/auth/session-context";
import type { ProgramTree } from "@/lib/programming/program";
import { sendProgramOp } from "@/lib/programming/program-store";

/**
 * "Copy to…" in the Program Editor header. Order 20.
 *
 * Copies the whole program, or the block on screen, to a linked athlete or to
 * the coach themselves, as a new draft. The athlete is typed, never picked
 * from a list (constraint 3). The server re-resolves exercises in the target's
 * library and keeps percentages as typed; this screen only says so.
 *
 * Kept in its own file so the editor gains one line, not a form.
 */

interface Person {
  id: string;
  name: string;
}

export function CopyProgram({
  tree,
  blockId,
  disabled,
  open: openProp,
  onClose,
}: {
  tree: ProgramTree;
  blockId: string | null;
  disabled?: boolean;
  /**
   * Opened from somewhere else -- the editor's program ⋯ menu -- rather than
   * by its own button. Given, the form shows only while it is true and Close
   * calls `onClose`.
   */
  open?: boolean;
  onClose?: () => void;
}) {
  const { state } = useSession();
  const coachId = state.status === "signed-in" ? state.user.id : null;
  const athleteIds = state.status === "signed-in" ? state.coach.athleteIds : null;
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Person | null>(null);
  const [onlyBlock, setOnlyBlock] = useState(false);
  const [startOn, setStartOn] = useState(tree.startOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; to: string } | null>(null);

  useEffect(() => {
    if (!open || !coachId || !athleteIds) return;
    let cancelled = false;
    void (async () => {
      const names = athleteIds.length > 0 ? await fetchAthleteNames(athleteIds).catch(() => []) : [];
      if (cancelled) return;
      const named = new Map(names.map((n) => [n.id, n.name]));
      setPeople([...athleteIds.map((id) => ({ id, name: named.get(id) ?? "Athlete" })), { id: coachId, name: "Yourself" }]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, coachId, athleteIds]);

  if (!open) {
    if (controlled) return null;
    return (
      <Button variant="secondary" disabled={disabled} onClick={() => setOwnOpen(true)}>
        Copy to…
      </Button>
    );
  }

  const block = tree.blocks.find((b) => b.id === blockId) ?? null;
  const q = query.trim().toLowerCase();
  const matches = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;

  const submit = async () => {
    if (!target) return setError("Type who it is for.");
    setBusy(true);
    setError(null);
    try {
      const { rowId } = await sendProgramOp({
        op: "copyProgram",
        programId: tree.id,
        athleteId: target.id,
        ...(onlyBlock && block ? { blockId: block.id } : {}),
        startOn: startOn || null,
      });
      setCopied({ id: rowId, to: target.name });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not copy it. Nothing was published.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Copy program"
      className="flex w-[min(40rem,100%)] flex-col gap-3 rounded-card border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {copied ? (
        <p role="status" className="m-0 text-body">
          Copied to {copied.to} as a draft.{" "}
          <Link href={`/coach/programs/${copied.id}`} className="font-semibold underline">
            Open the copy
          </Link>
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="copy-target">Copy to</FieldLabel>
        <TextField
          id="copy-target"
          autoFocus
          autoComplete="off"
          value={target ? target.name : query}
          placeholder="Type an athlete's name"
          onChange={(e) => {
            setTarget(null);
            setQuery(e.target.value);
          }}
        />
        {target ? null : (
          <ul aria-label="Athletes" className="m-0 flex list-none flex-wrap gap-1 p-0">
            {matches.map((p) => (
              <li key={p.id}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setTarget(p)}>
                  {p.name}
                </Button>
              </li>
            ))}
            {people.length > 0 && matches.length === 0 ? (
              <li className="text-ui text-muted">Nobody you coach by that name.</li>
            ) : null}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {block && tree.blocks.length > 1 ? (
          <label className="flex items-center gap-2 text-ui">
            <input type="checkbox" checked={onlyBlock} onChange={(e) => setOnlyBlock(e.target.checked)} />
            Only {block.name}
          </label>
        ) : null}
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="copy-start">Starts</FieldLabel>
          <TextField id="copy-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </div>
      </div>
      <p className="m-0 text-ui text-muted">
        Starts as a draft. Percentages stay percentages of their maxes; fixed kilos are copied as written.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !target}>
          {busy ? "Copying…" : "Copy"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (controlled) onClose?.();
            else setOwnOpen(false);
            setCopied(null);
            setTarget(null);
            setQuery("");
          }}
        >
          Close
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-ui text-danger-line">
          {error}
        </p>
      ) : null}
    </form>
  );
}
