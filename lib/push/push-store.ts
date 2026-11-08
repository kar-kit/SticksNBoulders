"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { DEFAULT_PUSH_PREFS, PUSH_TABLE, prefsOf, type PushPrefs } from "@/appwrite/documents/push";
import { detectEnv } from "@/lib/ui/screen-transition";
import { applicationServerKey, pushAvailability, type PushAvailability } from "./availability";

/**
 * The browser half of F27: the Push API, and /api/push behind it.
 *
 * Reads go straight to Appwrite -- each device row is stamped readable by its
 * owner -- and writes go through the route, because the table is server-only.
 */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** How long to wait for the service worker before saying there is none (dev has none). */
const WORKER_WAIT_MS = 5000;

export function detectPushAvailability(): PushAvailability {
  const { ios, standalone } = detectEnv();
  const hasNotification = typeof Notification !== "undefined";
  return pushAvailability({
    publicKey: VAPID_PUBLIC_KEY,
    hasServiceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    hasNotification,
    ios,
    standalone,
    permission: hasNotification ? Notification.permission : "default",
  });
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const ready = navigator.serviceWorker.ready;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("no-worker")), WORKER_WAIT_MS),
  );
  return Promise.race([ready, timeout]);
}

/** This device's subscription, if it has one. Never prompts. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function call(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown): Promise<Record<string, unknown>> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error(`${method} ${path}: ${response.status}`) as Error & { code: number };
    error.code = response.status;
    throw error;
  }
  return (await response.json()) as Record<string, unknown>;
}

export type EnableResult = { status: "on"; prefs: PushPrefs } | { status: "denied" } | { status: "dismissed" };

/**
 * Turns this device on. Call it straight from a tap: the permission request
 * is the first thing it does, because Safari only shows the prompt while the
 * gesture is still live.
 */
export async function enablePush(prefs?: PushPrefs): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { status: "denied" };
  if (permission !== "granted") return { status: "dismissed" };

  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(VAPID_PUBLIC_KEY) }));
  const body = await call("POST", "/api/push", { subscription: subscription.toJSON(), ...(prefs ? { prefs } : {}) });
  const saved = body.prefs as Partial<PushPrefs> | undefined;
  return { status: "on", prefs: { clips: saved?.clips !== false, replies: saved?.replies !== false } };
}

/** Turns this device off: the server forgets it, then the browser does. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await call("DELETE", "/api/push", { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

export async function savePushPrefs(prefs: PushPrefs): Promise<void> {
  await call("PATCH", "/api/push", { prefs });
}

export async function sendTestPush(): Promise<{ delivered: number; devices: number }> {
  const body = await call("POST", "/api/push/test", {});
  return { delivered: Number(body.delivered) || 0, devices: Number(body.devices) || 0 };
}

/** The switches as stored, read from the coach's own rows. Defaults when they have none. */
export async function readMyPushPrefs(userId: string): Promise<{ prefs: PushPrefs; endpoints: string[] }> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: PUSH_TABLE,
    queries: [Query.equal("user_id", userId), Query.select(["endpoint", "notify_clips", "notify_replies"]), Query.limit(20)],
    ttl: 0,
  });
  const rows = page.rows as unknown as Array<Record<string, unknown>>;
  return {
    prefs: rows[0] ? prefsOf(rows[0]) : DEFAULT_PUSH_PREFS,
    endpoints: rows.map((r) => (typeof r.endpoint === "string" ? r.endpoint : "")).filter(Boolean),
  };
}

/**
 * Sign-out: this device stops getting the signed-out coach's notifications.
 * Bounded and silent -- signing out never waits on a push service.
 */
export async function forgetPushDevice(timeoutMs = 3000): Promise<void> {
  await Promise.race([
    disablePush().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
