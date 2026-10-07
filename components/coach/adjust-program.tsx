"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { useSession } from "@/lib/auth/session-context";
import { editorHref, resolveAdjustTarget, type AdjustTarget } from "@/lib/coach/adjust-program";
import { fetchTracedLine } from "@/lib/coach/adjust-program-store";
import { decideAthleteAccess } from "@/lib/coach/athlete-view";
import { fetchLinkRows } from "@/lib/coach/athlete-view-store";
import type { Program } from "@/lib/programming/program";
import { fetchPrograms } from "@/lib/programming/program-store";

/**
 * "Adjust program": /coach/programs?athlete=<id>[&line=<prescriptionId>].
 *
 * Reached from a clip in the Review Queue and from Athlete View. Decides where
 * to land (lib/coach/adjust-program.ts) and replaces itself with the editor,
 * so Back goes to where the coach came from rather than to this hop.
 *
 * The link is checked FIRST and alone. Unlike Athlete View, nothing about the
 * athlete is read until it answers: there is no panel to pre-warm here, and a
 * coach typing a stranger's id into the URL should cost the stranger nothing,
 * not even a refused read.
 */

type View =
  | { status: "checking" }
  | { status: "failed" }
  | { status: "decided"; target: Exclude<AdjustTarget, { kind: "editor" }>; name: string | null };

const STATUS_LABEL: Record<Program["status"], string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function AdjustProgram({ athleteId, lineId }: { athleteId: string; lineId: string | null }) {
  const { state } = useSession();
  const router = useRouter();
  const coachId = state.status === "signed-in" ? state.user.id : null;
  const [view, setView] = useState<View & { for?: string }>({ status: "checking" });

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    void (async () => {
      try {
        const access = decideAthleteAccess(coachId, athleteId, await fetchLinkRows(coachId, athleteId));
        if (access.kind !== "linked") {
          if (!cancelled) {
            setView({ status: "decided", target: { kind: "refused", access }, name: null, for: athleteId });
          }
          return;
        }
        const [programs, line, names] = await Promise.all([
          fetchPrograms({ athleteId }),
          lineId ? fetchTracedLine(lineId) : Promise.resolve(null),
          fetchAthleteNames([athleteId]).catch(() => []),
        ]);
        if (cancelled) return;
        const target = resolveAdjustTarget({ athleteId, access, programs, line });
        if (target.kind === "editor") {
          // Stays on "Opening…" until the editor replaces it.
          router.replace(editorHref(target.programId, target.landing));
          return;
        }
        setView({ status: "decided", target, name: names[0]?.name ?? null, for: athleteId });
      } catch {
        // Could not ask is not the same as told no. Fails closed.
        if (!cancelled) setView({ status: "failed", for: athleteId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coachId, athleteId, lineId, router]);

  const current: View = view.for === athleteId ? view : { status: "checking" };

  if (current.status === "checking") {
    return (
      <div className="p-8 text-ui text-muted" aria-busy>
        Opening their program…
      </div>
    );
  }

  if (current.status === "failed") {
    return (
      <Centered>
        <EmptyState
          title="Couldn’t open their program"
          body="Nothing was changed. Check your connection and try again."
          action={<ProgramsLink />}
        />
      </Centered>
    );
  }

  const { target, name } = current;
  const who = name ?? "this athlete";

  if (target.kind === "refused") {
    // Same words as Athlete View, and no name for the same reason (Order 16.6).
    return (
      <Centered>
        {target.access.kind === "revoked" ? (
          <EmptyState
            title="No longer linked"
            body="This athlete ended the link, so you can no longer adjust their program. If that was a mistake, they can link again with your invite code."
            action={<ProgramsLink />}
          />
        ) : (
          <EmptyState
            title="Not one of your athletes"
            body="You can only program for athletes who have linked to you with your invite code."
            action={<ProgramsLink />}
          />
        )}
      </Centered>
    );
  }

  if (target.kind === "none") {
    return (
      <Centered>
        <EmptyState
          title={`No program for ${who} yet`}
          body="Nobody has written them a block. Start one under Programs and this link will open it next time."
          action={
            <Link href="/coach/programs" autoFocus className="text-ui text-foreground underline">
              Write their first block
            </Link>
          }
        />
      </Centered>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-8">
      <h1 className="m-0 text-display font-semibold">{name ?? "Their programs"}</h1>
      <p className="m-0 text-body text-muted">
        Nothing of theirs is published, so there is no current block to open. Pick one to carry on with.
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {target.programs.map((program, at) => (
          <li key={program.id}>
            <Link
              href={`/coach/programs/${program.id}`}
              autoFocus={at === 0}
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
      <ProgramsLink />
    </div>
  );
}

function ProgramsLink() {
  return (
    <Link href="/coach/programs" className="text-ui text-muted underline">
      All programs
    </Link>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-8">{children}</div>;
}
