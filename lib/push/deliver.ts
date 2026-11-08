import { deletePushSubscription, markPushDelivered, type WriteDeps } from "@/appwrite/documents/write";
import type { PushMessage } from "./message";

/**
 * Sending one message to a set of devices, and tidying up after the push
 * services' answers (F27). Shared by the notify Function and /api/push/test,
 * so a dead device is removed the same way whichever one finds it.
 */

export interface PushTarget {
  rowId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The push service's HTTP status, or 0 when it could not be reached at all. */
export interface SendResult {
  statusCode: number;
}

export type Send = (target: PushTarget, payload: string) => Promise<SendResult>;

export interface DeliverDeps {
  send: Send;
  write: WriteDeps;
  log: (message: string) => void;
}

export type Outcome = "delivered" | "gone" | "failed";

/**
 * 201 is the push service accepting it. 404 and 410 are the browser having
 * dropped the subscription -- permission revoked, site data cleared, the app
 * deleted from the home screen -- and the row will never work again. Anything
 * else (413, 429, a 5xx, no network) may work next time, so the row stays.
 */
export function outcomeFor(statusCode: number): Outcome {
  if (statusCode >= 200 && statusCode < 300) return "delivered";
  if (statusCode === 404 || statusCode === 410) return "gone";
  return "failed";
}

export interface DeliverResult {
  delivered: number;
  removed: number;
  failed: number;
}

export async function deliver(deps: DeliverDeps, targets: readonly PushTarget[], message: PushMessage): Promise<DeliverResult> {
  const payload = JSON.stringify(message);
  const result: DeliverResult = { delivered: 0, removed: 0, failed: 0 };
  await Promise.all(
    targets.map(async (target) => {
      let statusCode = 0;
      try {
        statusCode = (await deps.send(target, payload)).statusCode;
      } catch {
        statusCode = 0;
      }
      const outcome = outcomeFor(statusCode);
      // Bookkeeping never fails the send: the coach got the message or did not
      // either way, and a missed timestamp is not worth an error.
      if (outcome === "delivered") {
        result.delivered += 1;
        await markPushDelivered(deps.write, { rowId: target.rowId, userId: target.userId }).catch(() => undefined);
      } else if (outcome === "gone") {
        result.removed += 1;
        await deletePushSubscription(deps.write, target.rowId).catch(() => undefined);
        deps.log(`push ${target.rowId}: ${statusCode}, subscription removed`);
      } else {
        result.failed += 1;
        deps.log(`push ${target.rowId}: ${statusCode || "unreachable"}, kept`);
      }
    }),
  );
  return result;
}

/** A stored row as a target, or null when it is missing a field a send needs. */
export function targetOf(row: Record<string, unknown>): PushTarget | null {
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  const target = { rowId: s("$id"), userId: s("user_id"), endpoint: s("endpoint"), p256dh: s("p256dh"), auth: s("auth") };
  return Object.values(target).every(Boolean) ? target : null;
}
