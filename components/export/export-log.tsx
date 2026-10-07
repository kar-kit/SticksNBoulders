"use client";

import { useState } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import { Button } from "@/components/ui/button";
import { buildTrainingLogExport, deliverFile } from "@/lib/export/export-log";
import { fetchProfile } from "@/lib/profile/profile-store";

/**
 * DATA, from the Profile & Settings blueprint: the training log as a CSV.
 *
 * One component for both surfaces. On Me it exports the signed-in athlete; on
 * a coach's Athlete View it exports that athlete, and Appwrite decides whether
 * the coach may -- see training-log-store.ts. The difference between the two
 * is only how the file is handed over.
 *
 * Constraint 6 is why this exists at all: the competition is Excel, and a coach
 * who can get his data out is a coach who does not need to keep the
 * spreadsheet "just in case".
 */

type State =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done"; setCount: number; sessionCount: number; skipped: number }
  | { status: "empty" }
  | { status: "failed" };

export interface ExportLogProps {
  athleteId: string;
  /** Used in the file name. Looked up from the profile when not given. */
  athleteName?: string | null;
  audience: "athlete" | "coach";
}

export function ExportLog({ athleteId, athleteName, audience }: ExportLogProps) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function run() {
    setState({ status: "working" });
    try {
      const name = athleteName ?? (await fetchProfile(athleteId))?.displayName ?? null;
      const { tables, databaseId } = browserAppwrite();
      const built = await buildTrainingLogExport(tables, databaseId, { id: athleteId, name });
      if (built.setCount === 0) {
        setState({ status: "empty" });
        return;
      }
      // The athlete is on a phone; the coach is at a desk. See deliverFile.
      const delivered = await deliverFile(built.fileName, built.parts, { preferShare: audience === "athlete" });
      // Dismissing the share sheet is a change of mind, not a failure, and no
      // file went anywhere -- so back to the button, with no "Exported" line.
      if (!delivered) {
        setState({ status: "idle" });
        return;
      }
      setState({
        status: "done",
        setCount: built.setCount,
        sessionCount: built.sessionCount,
        skipped: built.skipped,
      });
    } catch {
      setState({ status: "failed" });
    }
  }

  const working = state.status === "working";
  const whose = audience === "athlete" ? "your" : "their";

  return (
    <section aria-label="Data" className="flex flex-col items-start gap-2">
      <h2 className="m-0 text-caption font-semibold tracking-wide text-muted-2">DATA</h2>
      <p className="m-0 max-w-[340px] text-ui text-muted">
        Every set {audience === "athlete" ? "you have" : "they have"} logged, as a CSV that opens in
        Excel or Google Sheets.
      </p>
      <Button variant="secondary" onClick={() => void run()} disabled={working} aria-busy={working}>
        {working ? "Preparing…" : `Export ${whose} training log`}
      </Button>
      <p role="status" aria-live="polite" className="m-0 max-w-[340px] text-ui text-muted">
        {statusText(state, whose)}
      </p>
    </section>
  );
}

function statusText(state: State, whose: string): string {
  switch (state.status) {
    case "done": {
      const sets = `${state.setCount} ${state.setCount === 1 ? "set" : "sets"}`;
      const sessions = `${state.sessionCount} ${state.sessionCount === 1 ? "session" : "sessions"}`;
      const skipped =
        state.skipped > 0 ? ` ${state.skipped} unreadable ${state.skipped === 1 ? "row was" : "rows were"} left out.` : "";
      return `Exported ${sets} from ${sessions}.${skipped}`;
    }
    case "empty":
      return `Nothing to export yet. Sets appear here once ${whose} first session syncs.`;
    case "failed":
      return "Could not reach the server. Nothing was changed; try again with signal.";
    default:
      return "";
  }
}
