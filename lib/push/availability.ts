/**
 * Can this device take push notifications, and if not, what to say (F27).
 * Pure: the browser facts come in, a state comes out.
 *
 * iPhone is the case that shapes this. Safari only exposes PushManager to a
 * site added to the Home Screen and opened from there, on iOS 16.4 or later
 * [Fact: WebKit, "Web Push for Web Apps on iOS and iPadOS", Feb 2023]. In a
 * Safari tab the API is simply absent, so a plain "unsupported" would tell a
 * coach on the right phone that it cannot be done. It can: install first.
 */

export type PushAvailability =
  /** The deployment has no VAPID public key. Nothing a coach can do. */
  | { kind: "unconfigured" }
  /** iOS in a Safari tab: install to the Home Screen first. */
  | { kind: "ios-install" }
  /** No service worker or Push API. On an installed iOS app, that means older than 16.4. */
  | { kind: "unsupported"; ios: boolean }
  /** The coach (or the OS) blocked notifications for this site. Only settings can undo it. */
  | { kind: "denied" }
  | { kind: "ready"; permission: "default" | "granted" };

export interface PushEnv {
  publicKey: string;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  ios: boolean;
  standalone: boolean;
  permission: "default" | "granted" | "denied";
}

export function pushAvailability(env: PushEnv): PushAvailability {
  if (!env.publicKey) return { kind: "unconfigured" };
  if (env.ios && !env.standalone) return { kind: "ios-install" };
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return { kind: "unsupported", ios: env.ios };
  if (env.permission === "denied") return { kind: "denied" };
  return { kind: "ready", permission: env.permission };
}

/** The VAPID public key as the bytes `pushManager.subscribe` wants. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
