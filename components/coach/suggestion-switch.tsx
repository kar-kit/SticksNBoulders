"use client";

import { useEffect, useId, useState } from "react";
import { useSession } from "@/lib/auth/session-context";
import { fetchLinkRows } from "@/lib/coach/athlete-view-store";
import { saveSuggestionMode } from "@/lib/coach/suggestion-mode-store";
import {
  DEFAULT_SUGGESTION_MODE,
  SUGGESTION_MODES,
  SUGGESTION_MODE_LABEL,
  type SuggestionMode,
} from "@/lib/coach/suggestion-mode";

/**
 * LOAD SUGGESTIONS, on the Athlete View (Order 28).
 *
 * The coach decides, per athlete, whether the logger suggests the next load
 * from the athlete's own RPE, or holds suggestions back. The Build Plan calls
 * it a coaching philosophy question, so the product does not answer it; it
 * only puts the switch where the coach looks at one athlete at a time.
 *
 * Reads the coach's own link row (readable to them, like the gate above it).
 * Writes through /api/link/suggestions, which refuses anyone but the coach on
 * an active link. Optimistic, and rolled back with a sentence if the write is
 * refused -- a switch that looks flipped and is not is worse than a slow one.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; mode: SuggestionMode; saving: boolean; error: string | null }
  | { status: "unavailable" };

const HINT: Record<SuggestionMode, string> = {
  direct: "After a set logged with an RPE, their logger suggests the next load toward what you prescribed. Always editable.",
  held: "Their logger suggests nothing and repeats the last set. You set the loads.",
};

export function SuggestionSwitch({ athleteId }: { athleteId: string }) {
  const { state: session } = useSession();
  const coachId = session.status === "signed-in" ? session.user.id : "";
  const [state, setState] = useState<State & { for?: string }>({ status: "loading" });
  const name = useId();

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    void fetchLinkRows(coachId, athleteId)
      .then((rows) => {
        if (cancelled) return;
        const active = rows.find(
          (row) => row.coachId === coachId && row.athleteId === athleteId && row.status === "active",
        );
        setState(
          active
            ? {
                status: "ready",
                mode: active.suggestionsMode ?? DEFAULT_SUGGESTION_MODE,
                saving: false,
                error: null,
                for: athleteId,
              }
            : { status: "unavailable", for: athleteId },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable", for: athleteId });
      });
    return () => {
      cancelled = true;
    };
  }, [coachId, athleteId]);

  const current: State = state.for === athleteId ? state : { status: "loading" };
  // Nothing to switch without an active link; the gate above already says why.
  if (current.status === "unavailable") return null;

  const choose = async (mode: SuggestionMode) => {
    if (current.status !== "ready" || current.saving || mode === current.mode) return;
    const previous = current.mode;
    setState({ status: "ready", mode, saving: true, error: null, for: athleteId });
    try {
      const saved = await saveSuggestionMode(athleteId, mode);
      setState({ status: "ready", mode: saved, saving: false, error: null, for: athleteId });
    } catch {
      setState({
        status: "ready",
        mode: previous,
        saving: false,
        error: `Couldn’t save that, so it’s still “${SUGGESTION_MODE_LABEL[previous]}”. Check your connection and try again.`,
        for: athleteId,
      });
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${name}-heading`}>
      <h2 id={`${name}-heading`} className="m-0 text-label uppercase tracking-wide text-muted">
        Load suggestions
      </h2>

      {current.status === "loading" ? (
        <p className="m-0 text-ui text-muted">Loading…</p>
      ) : (
        <>
          <div role="radiogroup" aria-labelledby={`${name}-heading`} className="flex flex-col gap-2">
            {SUGGESTION_MODES.map((mode) => (
              <label key={mode} className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name={name}
                  value={mode}
                  checked={current.mode === mode}
                  disabled={current.saving}
                  onChange={() => void choose(mode)}
                  className="mt-1"
                />
                <span className="flex flex-col">
                  <span className="text-body">{SUGGESTION_MODE_LABEL[mode]}</span>
                  <span className="text-caption text-muted">{HINT[mode]}</span>
                </span>
              </label>
            ))}
          </div>
          {current.saving ? <p className="m-0 text-caption text-muted">Saving…</p> : null}
          {current.error ? (
            <p role="alert" className="m-0 text-caption text-danger-line">
              {current.error}
            </p>
          ) : null}
          {/* Honest about today: the engine needs a prescribed target RPE, and
              prescriptions do not reach the logger until Order 22. */}
          <p className="m-0 text-caption text-muted-2">
            Suggestions need a prescribed target RPE, so none appear until programs reach the logger.
          </p>
        </>
      )}
    </section>
  );
}
