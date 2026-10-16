"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSession } from "@/lib/auth/session-context";
import { fetchLinkRows } from "@/lib/coach/athlete-view-store";
import { saveSuggestionMode } from "@/lib/coach/suggestion-mode-store";
import { cn } from "@/lib/cn";
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
 *
 * A compact setting in the page header, not a panel (Joey's review, 16 Oct
 * 2026: no longer front and centre). It is set once per athlete and rarely
 * touched, so the page shows only what it is set to; the choice and what each
 * option does open beneath it on request. Disclosure rather than a menu,
 * because what opens is a radio group with explanations, not a list of
 * commands. Escape or a click elsewhere folds it away, and an error stays
 * visible on the folded control until the next change, so a refused write is
 * never hidden by closing the panel.
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
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    // On the document, not the wrapper: choosing an option disables the
    // radios while it saves, which drops focus to the body, and an Escape
    // from there must still fold the panel away.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      const focus = document.activeElement;
      if (!focus || focus === document.body || wrapper.current?.contains(focus)) trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

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

  const summary = current.status === "ready" ? SUGGESTION_MODE_LABEL[current.mode] : "Loading…";

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={`${name}-panel`}
        disabled={current.status !== "ready"}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-chip border border-border px-3 text-caption text-muted",
          "hover:text-foreground disabled:text-muted-2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        )}
      >
        <GearIcon />
        <span className="font-mono text-label-xs uppercase text-muted-2">Load suggestions</span>
        <span className="text-foreground">{summary}</span>
        <span aria-hidden className="text-muted-2">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {current.status === "ready" && current.error && !open ? (
        <p role="alert" className="m-0 mt-1 max-w-[320px] text-caption text-danger-line">
          {current.error}
        </p>
      ) : null}

      {open && current.status === "ready" ? (
        <div
          id={`${name}-panel`}
          className="absolute right-0 top-full z-20 mt-2 flex w-[340px] flex-col gap-3 rounded-control border border-border bg-surface p-4"
        >
          <p id={`${name}-heading`} className="m-0 text-label uppercase tracking-wide text-muted">
            Load suggestions
          </p>
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
                  <span className="text-ui">{SUGGESTION_MODE_LABEL[mode]}</span>
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
        </div>
      ) : null}
    </div>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}
