import webpush from "web-push";
import type { PushTarget, Send } from "./deliver";

/**
 * web-push, configured from the environment (F27). Server-only: the Next
 * routes and the notify Function import it, never a component.
 *
 * The three variables, by name only (values live in Vercel and in the
 * Function's variables, never in the repo -- docs/push-notifications.md):
 *
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  the application server key. Public by
 *                                 design: the browser needs it to subscribe.
 *   VAPID_PRIVATE_KEY             its private half. A secret.
 *   VAPID_SUBJECT                 mailto: or https: contact for the push
 *                                 services, required by the VAPID spec.
 */

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export const VAPID_ENV = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

/** The keys, or null when any is missing or the subject is not a contact. */
export function vapidFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): Vapid | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/**
 * How long a push service holds a message for a device that is off. A day:
 * a clip from this morning is still worth knowing about tonight, a week-old
 * one is in the queue anyway.
 */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;

export function webPushSender(vapid: Vapid): Send {
  return async (target: PushTarget, payload: string) => {
    try {
      const response = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: PUSH_TTL_SECONDS,
          urgency: "normal",
          timeout: 10_000,
        },
      );
      return { statusCode: response.statusCode };
    } catch (error) {
      // WebPushError carries the push service's status; anything else (DNS,
      // a reset) is "unreachable", which keeps the row.
      const status = (error as { statusCode?: unknown })?.statusCode;
      return { statusCode: typeof status === "number" ? status : 0 };
    }
  };
}
