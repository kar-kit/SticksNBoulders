import { readLocal, removeLocal, writeLocal } from "@/lib/local-store";
import type { RestTimer } from "./rest-timer";

/**
 * The running rest, remembered across a reload.
 *
 * Cheap, and the alternative is silly: a phone that reloads between sets --
 * which on a PWA is an ordinary thing to happen -- would otherwise lose a
 * timer the athlete is standing there watching. It is derived from a timestamp,
 * so what comes back is the real remaining time and not a stale one.
 */

const KEY = "snb.rest-timer";

/**
 * How old a stored rest can be and still mean anything.
 *
 * Nobody comes back to a rest an hour later. Without this, a phone reopened the
 * next morning shows a timer counting up through the night, which is both
 * absurd and a number the athlete has to work out how to get rid of.
 */
const MAX_AGE_MS = 60 * 60 * 1000;

export function rememberRest(timer: RestTimer): void {
  writeLocal(KEY, { startedAt: timer.startedAt.toISOString(), restMs: timer.restMs });
}

export function forgetRest(): void {
  removeLocal(KEY);
}

export function recallRest(now: Date = new Date()): RestTimer | null {
  const stored = readLocal<{ startedAt?: unknown; restMs?: unknown }>(KEY);
  if (typeof stored?.startedAt !== "string" || typeof stored.restMs !== "number") return null;
  const startedAt = new Date(stored.startedAt);
  if (Number.isNaN(startedAt.getTime())) return null;
  if (now.getTime() - startedAt.getTime() > MAX_AGE_MS) return null;
  return { startedAt, restMs: stored.restMs };
}
