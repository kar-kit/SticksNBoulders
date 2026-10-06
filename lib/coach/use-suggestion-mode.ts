"use client";

import { useEffect, useState } from "react";
import { UNKNOWN_SUGGESTION_MODE, type SuggestionMode } from "./suggestion-mode";
import { loadSuggestionMode, recallSuggestionMode, type ModeSource } from "./suggestion-mode-store";

/**
 * The athlete's suggestion mode, for screens that act on it.
 *
 * Starts from the last copy this device saw, so the logger is right from the
 * first set even with no signal, then asks Appwrite. Asks again when the
 * signal comes back and when the app returns to the foreground -- a coach can
 * flip the switch mid-session, and the next suggestion should obey it.
 *
 * A failed read never moves the value: what is cached stays what applies.
 */
export function useSuggestionMode(athleteId: string | null): { mode: SuggestionMode; source: ModeSource } {
  const [state, setState] = useState<{ for: string | null; mode: SuggestionMode; source: ModeSource }>({
    for: null,
    mode: UNKNOWN_SUGGESTION_MODE,
    source: "unknown",
  });

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;

    const refresh = async () => {
      const next = await loadSuggestionMode(athleteId);
      if (cancelled) return;
      setState((now) =>
        // A failed read reports the cache; never let it overwrite a live
        // answer this page already has.
        next.source !== "live" && now.for === athleteId && now.source === "live"
          ? now
          : { for: athleteId, ...next },
      );
    };

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const cached = recallSuggestionMode(athleteId);
      if (cached) setState({ for: athleteId, mode: cached, source: "cached" });
      await refresh();
    })();

    const onOnline = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [athleteId]);

  if (state.for !== athleteId) return { mode: UNKNOWN_SUGGESTION_MODE, source: "unknown" };
  return { mode: state.mode, source: state.source };
}
