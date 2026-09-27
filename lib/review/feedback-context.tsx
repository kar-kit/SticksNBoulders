"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth/session-context";
import { fetchHasCoach, fetchUnreadCount, subscribeToComments } from "./feedback-store";
import { readSeenAt, writeSeenAt } from "./feedback-seen";

/**
 * Whether there is coach feedback the athlete has not seen, for the tab bar
 * and Today.
 *
 * Mounted around the shell rather than inside it, because the tab bar is part
 * of the shell and is the thing that shows the dot. Two cheap reads -- one
 * link row, up to ten comment ids -- and neither blocks anything: the chrome
 * paints first and the dot arrives when it arrives.
 *
 * The blueprint calls this "the one notification worth having", since a
 * coach's comment is time-sensitive in a way nothing else in the app is. So it
 * refreshes on focus and on realtime, not only on load: an athlete who opens
 * the app between sets should see Ruairi's note from ten minutes ago.
 */

export interface FeedbackBadge {
  /** Null until known. The Today entry waits rather than flickering in. */
  hasCoach: boolean | null;
  unread: number;
  /** The watermark on this device, for marking cards "New". */
  seenAt: string | null;
  /** Records what the athlete has now seen, and clears the dot. */
  markSeen: (seenAt: string | null) => void;
  refresh: () => void;
}

const NONE: FeedbackBadge = {
  hasCoach: null,
  unread: 0,
  seenAt: null,
  markSeen: () => {},
  refresh: () => {},
};

const FeedbackContext = createContext<FeedbackBadge | null>(null);

/**
 * Outside a provider this answers "nothing new" rather than throwing, so the
 * tab bar still renders in a test or on a screen that never mounted one.
 */
export function useFeedbackBadge(): FeedbackBadge {
  return useContext(FeedbackContext) ?? NONE;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const userId = state.status === "signed-in" ? state.user.id : "";

  const [hasCoach, setHasCoach] = useState<boolean | null>(null);
  const [unread, setUnread] = useState(0);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    if (!userId) return;
    const mine = ++generation.current;
    const watermark = readSeenAt(userId);
    void fetchUnreadCount(userId, watermark)
      .then((count) => {
        if (generation.current !== mine) return;
        setSeenAt(watermark);
        setUnread(count);
      })
      // Offline, or Appwrite down: keep whatever was last shown. A dot that
      // vanishes because the gym has no signal would be a lie.
      .catch(() => {});
    void fetchHasCoach(userId)
      .then((linked) => {
        if (generation.current === mine) setHasCoach(linked);
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = subscribeToComments(refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [userId, refresh]);

  const markSeen = useCallback(
    (next: string | null) => {
      if (!userId) return;
      writeSeenAt(userId, next);
      // Bump the generation so a count that was in flight when the screen
      // opened cannot land afterwards and put the dot back.
      generation.current++;
      setSeenAt(readSeenAt(userId));
      setUnread(0);
    },
    [userId],
  );

  const value = useMemo<FeedbackBadge>(
    () => ({ hasCoach, unread, seenAt, markSeen, refresh }),
    [hasCoach, unread, seenAt, markSeen, refresh],
  );

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}
