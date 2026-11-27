"use client";

import { useEffect, useState } from "react";
import { localDay } from "@/lib/programming/program";
import { coversDay, openSpells, type SickSpell } from "@/lib/sick/sick";
import { sickShortRange } from "@/lib/sick/labels";
import { fetchSickDays } from "@/lib/sick/sick-store";

/**
 * F31: the athlete's call-ins, on their Athlete View -- the ones under way and
 * the ones still to come, each with its dates and the note they left.
 * Nothing at all when there are none: a banner that says "not sick" is noise
 * on the screen a coach opens every day.
 *
 * Read through the circle like every other panel here, so a coach who is not
 * linked reads no rows and the Athlete View's gate has already refused them
 * the screen. Mounted only once the link says so, so it never asks for what
 * it would be refused. A failed read shows nothing, as the panels beside it do:
 * the Roster's marker is the other place it can be seen.
 */
export function AthleteSick({ athleteId }: { athleteId: string }) {
  const [found, setFound] = useState<{ for: string; spells: SickSpell[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Behind an await so every update is asynchronous, as in the other panels.
      await Promise.resolve();
      try {
        const spells = await fetchSickDays([athleteId], localDay());
        if (!cancelled) setFound({ for: athleteId, spells });
      } catch {
        if (!cancelled) setFound({ for: athleteId, spells: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const today = localDay();
  const open = found?.for === athleteId ? openSpells(found.spells, today) : [];
  if (open.length === 0) return null;
  const now = new Date();

  return (
    <section aria-label="Sick" className="flex flex-col gap-1 rounded-control border border-accent-line bg-surface px-3 py-2 text-ui">
      {open.map((spell) => (
        <p key={spell.id} className="m-0 flex flex-wrap gap-x-3">
          <span className="font-semibold">{coversDay(spell, today) ? "Off sick" : "Sick from"}</span>
          <span>{sickShortRange(spell.startsOn, spell.endsOn, now)}</span>
          {spell.note ? <span className="text-muted">&ldquo;{spell.note}&rdquo;</span> : null}
        </p>
      ))}
    </section>
  );
}
