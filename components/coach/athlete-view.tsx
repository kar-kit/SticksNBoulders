"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AthleteBodyweight } from "@/components/coach/athlete-bodyweight";
import { AthleteLifts } from "@/components/coach/athlete-lifts";
import { AthleteProgram } from "@/components/coach/athlete-program";
import { AthleteSessions } from "@/components/coach/athlete-sessions";
import { AthleteVideos } from "@/components/coach/athlete-videos";
import { CurrentMaxes } from "@/components/coach/current-maxes";
import { SuggestionSwitch } from "@/components/coach/suggestion-switch";
import { useAthletePanel } from "@/components/coach/use-athlete-panel";
import { ExportLog } from "@/components/export/export-log";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/lib/auth/session-context";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { decideAthleteAccess, shortDate, type AthleteAccess } from "@/lib/coach/athlete-view";
import { fetchLinkRows } from "@/lib/coach/athlete-view-store";
import { UserAvatar } from "@/components/profile/user-avatar";

/**
 * Athlete View. Order 25, requested by Ruairi: everything about one person on
 * one screen -- the direct answer to having to go back and remember maxes.
 *
 * The gate comes first. Only a coach with an ACTIVE row in
 * `coach_athlete_links` sees anything, and "not linked" and "no longer
 * linked" are screens with words on them rather than a 401 or a page of empty
 * panels that would read as an athlete who never trained. Permissions enforce
 * the same thing underneath -- a coach reads through the athlete's circle
 * team, which a revoke removes them from -- so this is the screen telling the
 * truth about the permission model, not a second one.
 *
 * The panels start fetching while the link is checked, hidden, so the check
 * costs no extra round trip on a screen held to 2.5s. Nothing is shown until
 * the link says so; a coach who is not linked gets refused reads and never
 * sees them.
 *
 * The link is re-checked when the tab comes back into focus, because the
 * session's list of athletes was read when the app loaded and a coach can sit
 * on this screen for an hour.
 *
 * ## Layout (Joey's review of the dashboard, 16 Oct 2026)
 *
 * Desktop-first at 1440x900 beside the athlete rail, in order of what a coach
 * reads on every visit:
 *
 * - **Header**: name, a small "linked" pill, the bodyweight figure (which
 *   opens its history over the page), and load suggestions as a compact
 *   setting on the right -- set once per athlete, so it shows its value and
 *   folds its explanation away.
 * - **Top, two columns**: CURRENT MAXES (squat, bench, deadlift and DOTS in
 *   one table) with the videos under it; THIS BLOCK, the current week at a
 *   glance, beside them. The program takes a full column because it is the
 *   tallest thing on the page and the one the coach acts on.
 * - **Below, full width, lower priority**: the per-lift e1RM chart, recent
 *   sessions, and the CSV export. History is read when something above raises
 *   a question, not first.
 *
 * The bodyweight history and an opened clip are dialogs held in the URL (see
 * use-athlete-panel.ts), so Back closes them and the panels underneath stay
 * loaded.
 */

type Gate = { status: "checking" } | { status: "decided"; access: AthleteAccess } | { status: "failed" };

export function AthleteView({ athleteId }: { athleteId: string }) {
  const { state: session } = useSession();
  const coachId = session.status === "signed-in" ? session.user.id : "";
  const [gate, setGate] = useState<Gate & { for?: string }>({ status: "checking" });
  const [name, setName] = useState<{ for: string; name: string | null } | null>(null);
  const { panel, open, close } = useAthletePanel();

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;

    const check = async () => {
      try {
        const rows = await fetchLinkRows(coachId, athleteId);
        if (!cancelled) {
          setGate({ status: "decided", access: decideAthleteAccess(coachId, athleteId, rows), for: athleteId });
        }
      } catch {
        // Could not ask is not the same as told no. Said as such, and nothing
        // is shown -- the screen fails closed.
        if (!cancelled) setGate((now) => (now.for === athleteId && now.status === "decided" ? now : { status: "failed", for: athleteId }));
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [coachId, athleteId]);

  useEffect(() => {
    let cancelled = false;
    void fetchAthleteNames([athleteId])
      .then((found) => {
        if (!cancelled) setName({ for: athleteId, name: found[0]?.name ?? null });
      })
      .catch(() => {
        if (!cancelled) setName({ for: athleteId, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const current: Gate = gate.for === athleteId ? gate : { status: "checking" };
  const access = current.status === "decided" ? current.access : null;
  const linked = access?.kind === "linked";
  const displayName = name?.for === athleteId ? name.name : null;

  if (current.status === "failed") {
    return (
      <Centered>
        <EmptyState
          title="Couldn’t check this link"
          body="We couldn’t confirm you coach this athlete, so nothing is shown. Check your connection and refresh."
        />
      </Centered>
    );
  }

  if (access?.kind === "revoked") {
    return (
      <Centered>
        {/* No name, deliberately. Their profile is no longer readable to you,
            and whether a coach is told by name who left is [SME to confirm]
            on Order 16.6 -- it is a disclosure about someone who has just
            withdrawn consent. */}
        <EmptyState
          title="No longer linked"
          body={`This athlete ended the link${access.revokedAt ? ` on ${shortDate(access.revokedAt)}` : ""}, so their training is no longer visible to you. If that was a mistake, they can link again with your invite code.`}
          action={
            <Link href="/coach/roster" className="text-ui text-muted underline">
              Back to your roster
            </Link>
          }
        />
      </Centered>
    );
  }

  if (access?.kind === "not-linked") {
    return (
      <Centered>
        <EmptyState
          title="Not one of your athletes"
          body="You can only see athletes who have linked to you with your invite code."
          action={
            <Link href="/coach/roster" className="text-ui text-muted underline">
              Back to your roster
            </Link>
          }
        />
      </Centered>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-8" aria-busy={!linked}>
      {linked ? (
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <UserAvatar userId={athleteId} name={displayName ?? "Unnamed athlete"} size={40} />
            <h1 className="m-0 text-display font-semibold">{displayName ?? "Unnamed athlete"}</h1>
            {access.linkedAt ? (
              // A fact about the link, not about the athlete: small, beside
              // the name rather than competing with it.
              <span className="inline-flex h-6 items-center rounded-chip border border-border px-2 font-mono text-meta text-muted">
                linked {shortDate(access.linkedAt)}
              </span>
            ) : null}
            <AthleteBodyweight
              athleteId={athleteId}
              open={panel?.kind === "bodyweight"}
              onOpen={() => open({ kind: "bodyweight" })}
              onClose={close}
            />
          </div>
          <SuggestionSwitch athleteId={athleteId} />
        </header>
      ) : (
        <p className="m-0 text-ui text-muted">Loading…</p>
      )}

      {/* Mounted while checking so the reads start now; hidden until the link
          says they may be shown. */}
      <div hidden={!linked} className={linked ? "flex flex-col gap-12" : "hidden"}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-10 gap-y-10">
          <div className="flex min-w-0 flex-col gap-10">
            <CurrentMaxes athleteId={athleteId} />
            <AthleteVideos
              athleteId={athleteId}
              athleteName={displayName}
              // Never over panels that are still hidden behind the gate.
              openClipId={linked && panel?.kind === "clip" ? panel.clipId : null}
              onOpen={(clipId) => open({ kind: "clip", clipId })}
              onClose={close}
            />
          </div>
          <div className="min-w-0">
            <AthleteProgram athleteId={athleteId} />
          </div>
        </div>
        <div className="flex flex-col gap-10 border-t border-border pt-8">
          <AthleteLifts athleteId={athleteId} />
          <AthleteSessions athleteId={athleteId} />
          <ExportLog athleteId={athleteId} audience="coach" />
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center p-8">{children}</div>;
}
