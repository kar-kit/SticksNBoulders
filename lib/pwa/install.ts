/**
 * When to suggest installing to the home screen, and how.
 *
 * Installed matters here more than for most apps: in the browser, iOS Safari
 * can evict a site's storage after a week without a visit, and that storage is
 * where the offline queue lives. From the home screen it is exempt, it opens
 * full-screen with no address bar, and it is one tap from the lock screen.
 *
 * But nagging costs more than it earns, so the hint is shown sparingly:
 * not on the first day (that is sign-in and a first session, and the app has
 * not earned the ask yet), never again once dismissed for DISMISS_DAYS, never
 * once installed. [Inference -- the thresholds are a guess, not from Ruairi.]
 */
import { readLocal, writeLocal } from "@/lib/local-store";

export type InstallPlatform = "ios" | "prompt" | "none";

export interface InstallMemory {
  /** Distinct local dates the app was opened on, oldest first, at most two. */
  days: string[];
  dismissedAt: number | null;
  installed: boolean;
}

export const INSTALL_KEY = "snb.install";
export const DISMISS_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export function recallInstall(): InstallMemory {
  const stored = readLocal<Partial<InstallMemory>>(INSTALL_KEY);
  return {
    days: Array.isArray(stored?.days) ? stored.days.filter((d) => typeof d === "string").slice(-2) : [],
    dismissedAt: typeof stored?.dismissedAt === "number" ? stored.dismissedAt : null,
    installed: stored?.installed === true,
  };
}

export function saveInstall(memory: InstallMemory): void {
  writeLocal(INSTALL_KEY, memory);
}

/** Records today as a day the app was opened. Returns the updated memory. */
export function noteVisit(memory: InstallMemory, today: string): InstallMemory {
  if (memory.days.includes(today)) return memory;
  return { ...memory, days: [...memory.days, today].slice(-2) };
}

export function shouldShowHint(
  memory: InstallMemory,
  context: { platform: InstallPlatform; standalone: boolean; now: number },
): boolean {
  if (context.platform === "none" || context.standalone || memory.installed) return false;
  if (memory.dismissedAt !== null && context.now - memory.dismissedAt < DISMISS_DAYS * DAY_MS) return false;
  return memory.days.length >= 2;
}

/**
 * iOS has no install prompt an app can trigger; it only has the Share sheet.
 * iPadOS reports itself as a Mac, so a Mac with a touchscreen is an iPad.
 */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * In-app browsers (Instagram, Facebook, LinkedIn...) cannot add to the home
 * screen at all, so telling someone to tap Share there is a dead end.
 */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|Instagram|LinkedInApp|Line\/|GSA\//.test(userAgent);
}
