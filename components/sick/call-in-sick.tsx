"use client";

import { useState } from "react";
import { ModalSheet } from "@/components/logging/modal-sheet";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextField } from "@/components/ui/input";
import { PendingDot } from "@/components/ui/sync-mark";
import { SICK_MAX_DAYS, SICK_NOTE_MAX, inclusiveDays, isDayKey } from "@/appwrite/documents/sick";
import { addDays, localDay } from "@/lib/programming/program";
import { openSpells, sickNow } from "@/lib/sick/sick";
import { sickRangeLabel } from "@/lib/sick/labels";
import { useMySick } from "@/lib/sick/use-my-sick";

/**
 * Call in sick, on Today (F31, docs/call-in-sick.md).
 *
 * Three states of one small thing. Not sick: a 44px row, the same as My
 * program and Coach feedback beside it, that opens a bottom sheet -- a day or a
 * run of days, an optional line for the coach, and one big button in the
 * thumb's reach. Sick today: a card that says so, with "I'm better" under it.
 * A call-in still to come: the same card with "Cancel".
 *
 * Absent, not greyed out, for an athlete with no coach (the blueprint's rule
 * for every coach-only entry): a call-in is for somebody to read. One already
 * made still shows, so it can be ended after a coach has gone.
 *
 * It tells the athlete the two things they will wonder: the coach knows, and
 * nothing in the program has moved. Offline-first like every athlete write:
 * the card appears the moment it is tapped, with the quiet pending dot if it
 * has not reached Appwrite yet (docs/offline.md).
 */

export function CallInSick({ athleteId, hasCoach }: { athleteId: string | null; hasCoach: boolean | null }) {
  const sick = useMySick(athleteId);
  const [open, setOpen] = useState(false);
  const today = localDay();

  const now = sickNow(sick.spells, today);
  const ahead = openSpells(sick.spells, today).filter((s) => s.startsOn > today);
  const next = now ? null : (ahead[0] ?? null);

  // Nothing to ask and nothing to show: no coach, and nothing already made.
  if (hasCoach !== true && !now && !next) return null;

  // "Add days" starts the day after the run ends, so a second call-in joins it.
  const startsOn = now ? addDays(now.endsOn, 1) : today;

  return (
    <>
      {now ? (
        <section aria-label="Off sick" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-body font-semibold">
              {now.endsOn === today ? "Off sick today" : `Off sick until ${sickRangeLabel(now.endsOn, now.endsOn)}`}
            </p>
            {sick.pending ? <PendingDot /> : null}
          </div>
          {now.note ? <p className="m-0 text-ui text-muted">{now.note}</p> : null}
          <p className="m-0 text-ui text-muted">Your coach knows. Nothing in your program has moved.</p>
          <Button variant="secondary" block onClick={() => void sick.end(today)}>
            I&rsquo;m better
          </Button>
        </section>
      ) : next ? (
        <section aria-label="Sick, coming up" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-body font-semibold">Sick {sickRangeLabel(next.startsOn, next.endsOn)}</p>
            {sick.pending ? <PendingDot /> : null}
          </div>
          {next.note ? <p className="m-0 text-ui text-muted">{next.note}</p> : null}
          <Button variant="secondary" block onClick={() => void sick.end(today)}>
            Cancel
          </Button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] items-center justify-between rounded-control border border-border bg-surface px-[14px] text-left text-body active:bg-surface-2"
      >
        <span className="font-semibold">{now || next ? "Add days" : "Call in sick"}</span>
        <span className="text-ui text-muted-2">{now || next ? "Sick again" : "Tell your coach"}</span>
      </button>

      <ModalSheet label="Call in sick" onDismiss={() => setOpen(false)}>
        {open ? (
          <CallInForm
            defaultStart={startsOn}
            onCancel={() => setOpen(false)}
            onSubmit={async (draft) => {
              setOpen(false);
              await sick.callIn(draft);
            }}
          />
        ) : null}
      </ModalSheet>
    </>
  );
}

/** Why a draft cannot be sent, in words an athlete would use, or null. */
function draftProblem(startsOn: string, endsOn: string): string | null {
  if (!isDayKey(startsOn) || !isDayKey(endsOn)) return "Pick both days.";
  if (endsOn < startsOn) return "The last day cannot be before the first.";
  if (inclusiveDays(startsOn, endsOn) > SICK_MAX_DAYS) {
    return `A call-in covers up to ${SICK_MAX_DAYS} days. For longer, talk to your coach.`;
  }
  return null;
}

function CallInForm({
  defaultStart,
  onCancel,
  onSubmit,
}: {
  defaultStart: string;
  onCancel: () => void;
  onSubmit: (draft: { startsOn: string; endsOn: string; note: string }) => Promise<void>;
}) {
  const [startsOn, setStartsOn] = useState(defaultStart);
  const [endsOn, setEndsOn] = useState(defaultStart);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const problem = draftProblem(startsOn, endsOn);

  return (
    <section aria-label="Call in sick" className="flex flex-none flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 text-title font-semibold">Call in sick</h2>
        <p className="m-0 text-ui text-muted">
          Your coach is told straight away. Nothing in your program moves, and you can end it whenever you are better.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <FieldLabel htmlFor="sick-from">From</FieldLabel>
          <TextField
            id="sick-from"
            type="date"
            value={startsOn}
            onChange={(event) => {
              const next = event.target.value;
              setStartsOn(next);
              // The last day follows the first when it would end up before it.
              if (isDayKey(next) && (!isDayKey(endsOn) || endsOn < next)) setEndsOn(next);
            }}
            invalid={problem !== null && !isDayKey(startsOn)}
            className="min-w-0"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <FieldLabel htmlFor="sick-through">Through</FieldLabel>
          <TextField
            id="sick-through"
            type="date"
            value={endsOn}
            min={isDayKey(startsOn) ? startsOn : undefined}
            onChange={(event) => setEndsOn(event.target.value)}
            invalid={problem !== null && !isDayKey(endsOn)}
            className="min-w-0"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="sick-note">Note for your coach (optional)</FieldLabel>
        <TextField
          id="sick-note"
          value={note}
          maxLength={SICK_NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Flu, back Thursday"
          autoComplete="off"
        />
      </div>

      {problem ? (
        <p role="alert" className="m-0 text-ui text-muted">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          size="xl"
          block
          disabled={problem !== null || sending}
          onClick={() => {
            setSending(true);
            void onSubmit({ startsOn, endsOn, note });
          }}
        >
          Call in sick
        </Button>
        <Button variant="ghost" block onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
