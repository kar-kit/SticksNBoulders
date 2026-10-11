"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { readLocal, writeLocal } from "@/lib/local-store";
import { DEFAULT_UNITS, isUnits, type Units } from "./profile";
import { fetchProfile } from "./profile-store";

/**
 * The athlete's weight unit, for every screen that types or shows a load.
 *
 * Storage is kilograms everywhere (docs/profile.md); this is the display
 * preference, applied at the screen boundary by lib/units.ts. It lives in a
 * context rather than being read per screen because the logger needs it on
 * the first keypress, and a per-screen profile fetch would let a set typed in
 * the first second land as kilos for an athlete who reads pounds.
 *
 * Starts from the last unit this device saw, so a cold start with no signal is
 * still in the right unit, then reads the profile. A failed read never moves
 * it. Outside the provider -- the coach side, tests -- it is kilos, which is
 * what every one of those surfaces has always shown.
 */

interface UnitsValue {
  unit: Units;
  /** For the settings screen: the change applies everywhere at once. */
  setUnit: (unit: Units) => void;
}

const UnitsContext = createContext<UnitsValue>({ unit: DEFAULT_UNITS, setUnit: () => {} });

const keyFor = (userId: string) => `snb.units.${userId}`;

/** The unit this device last saw for this account, or null. */
export function recallUnits(userId: string): Units | null {
  const cached = readLocal<unknown>(keyFor(userId));
  return isUnits(cached) ? cached : null;
}

export function rememberUnits(userId: string, unit: Units): void {
  writeLocal(keyFor(userId), unit);
}

export function UnitsProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const [state, setState] = useState<{ for: string | null; unit: Units }>({ for: null, unit: DEFAULT_UNITS });
  /** Set once the athlete picks a unit here, so a slower read cannot undo it. */
  const chosen = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const cached = recallUnits(userId);
      if (cached) setState({ for: userId, unit: cached });
      // A read, never `ensureMyProfile`: a screen opening is no reason to
      // write a row. Null is no signal or no profile yet, and either way the
      // cached unit stands, or kilos if there was none.
      const profile = await fetchProfile(userId);
      if (cancelled || !profile || chosen.current) return;
      rememberUnits(userId, profile.units);
      setState({ for: userId, unit: profile.units });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setUnit = useCallback(
    (unit: Units) => {
      chosen.current = true;
      if (userId) rememberUnits(userId, unit);
      setState({ for: userId, unit });
    },
    [userId],
  );

  const unit = state.for === userId ? state.unit : DEFAULT_UNITS;
  const value = useMemo(() => ({ unit, setUnit }), [unit, setUnit]);
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsValue {
  return useContext(UnitsContext);
}
