import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * The Program Editor's clipboard. F28.
 *
 * Ruairi writes an idea into one program and wants it in another: "copy and
 * paste days and weeks ... then I can't move them around." So a day or a week
 * is copied in one program and pasted in any other the coach opens, for this
 * athlete or another.
 *
 * What is held is a reference -- the source row's id and enough words to name
 * it -- never the rows themselves. The paste is a server copy of the source
 * as it is when Paste is pressed (`copyDay` / `copyWeek`), so an edit made to
 * the source after copying is pasted too, and the server, not this tab,
 * remaps exercises and checks who may write where. [Inference] A snapshot
 * would paste what was on screen at the time, which is the spreadsheet
 * behaviour, but it would mean sending every line through the client.
 *
 * Held in sessionStorage: it survives moving between programs and athletes,
 * and a reload, and is gone when the tab closes. Per tab, so two tabs do not
 * fight over it. One item; copying again replaces it.
 */

const KEY = "snb:program-clipboard";

const clipItem = z.object({
  kind: z.enum(["day", "week"]),
  /** The day's or week's row id. */
  sourceId: z.string().min(1),
  programId: z.string().min(1),
  programName: z.string(),
  /** Whose program it came from: null for a template. */
  athleteId: z.string().nullable(),
  /** Their name for the cross-athlete notice; null for the coach's own or unknown. */
  athleteName: z.string().nullable(),
  /** "Squat day", "Week 3". */
  label: z.string().min(1),
  days: z.number().int().min(0),
  lines: z.number().int().min(0),
});

export type ClipItem = z.infer<typeof clipItem>;

const listeners = new Set<() => void>();
/** The parsed item for the raw string last read, so the snapshot is stable between changes. */
let cache: { raw: string | null; item: ClipItem | null } = { raw: null, item: null };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Storage blocked (a private window, a policy): a clipboard for this page only.
    return null;
  }
}

/** Held in memory too, so a tab without sessionStorage still has a clipboard for the page. */
let memory: string | null = null;

function readRaw(): string | null {
  const store = storage();
  if (!store) return memory;
  try {
    return store.getItem(KEY);
  } catch {
    return memory;
  }
}

function writeRaw(raw: string | null) {
  memory = raw;
  const store = storage();
  try {
    if (raw === null) store?.removeItem(KEY);
    else store?.setItem(KEY, raw);
  } catch {
    // Full or blocked: the memory copy stands.
  }
  for (const listener of listeners) listener();
}

/** What the clipboard holds, or null. Anything stored that does not parse is nothing. */
export function readClip(): ClipItem | null {
  const raw = readRaw();
  if (raw === cache.raw) return cache.item;
  let item: ClipItem | null = null;
  try {
    const parsed = clipItem.safeParse(raw === null ? null : JSON.parse(raw));
    item = parsed.success ? parsed.data : null;
  } catch {
    item = null;
  }
  cache = { raw, item };
  return item;
}

export function holdClip(item: ClipItem) {
  writeRaw(JSON.stringify(clipItem.parse(item)));
}

export function clearClip() {
  writeRaw(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The clipboard, live: every editor on the page sees a copy the moment it is made. */
export function useClip(): ClipItem | null {
  return useSyncExternalStore(subscribe, readClip, () => null);
}

/** "Squat day (4 lines)", "Week 3 (3 days)". */
export function clipSummary(item: ClipItem): string {
  const count =
    item.kind === "week"
      ? `${item.days} ${item.days === 1 ? "day" : "days"}`
      : `${item.lines} ${item.lines === 1 ? "line" : "lines"}`;
  return `${item.label} (${count})`;
}

/**
 * The id a paste goes out under, as `copyDay`'s and `copyWeek`'s
 * `requestId`. Twenty letters and digits, as Appwrite's own ids are long.
 */
export function newPasteId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
