import { createHash } from "node:crypto";
import { Client, Query, TablesDB } from "node-appwrite";
import { z } from "zod";
import { deliver, targetOf, type DeliverResult, type Send } from "@/lib/push/deliver";
import { testMessage } from "@/lib/push/message";
import { DEFAULT_PUSH_PREFS, PUSH_TABLE, isP256dh, isPushAuth, isPushEndpoint, prefsOf, type PushPrefs } from "./push";
import type { RowWriter } from "./row-writer";
import {
  createPushSubscription,
  deletePushSubscription,
  setPushPrefs,
  updatePushSubscription,
  type WriteDeps,
} from "./write";

/**
 * /api/push, server side (F27).
 *
 * The caller is whoever the JWT says. A body names a device (its endpoint)
 * and what it wants, never a user: a device is registered to the caller or to
 * nobody. The table is server-only (policy.ts pushSubscriptionPermissions),
 * so this module and the notify Function are the only writers.
 */

export interface PushTables {
  listRows(params: { databaseId: string; tableId: string; queries: string[] }): Promise<{ rows: Array<Record<string, unknown>> }>;
  writer: RowWriter;
}

export function adminPushTables(client: Client): PushTables {
  const db = new TablesDB(client);
  return {
    listRows: (params) => db.listRows(params) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>,
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
  };
}

/** sha256 of the endpoint, and the row id derived from it: one device, one row. */
export function pushRowId(endpoint: string): { rowId: string; hash: string } {
  const hash = createHash("sha256").update(endpoint).digest("hex");
  return { rowId: `push_${hash.slice(0, 31)}`, hash };
}

/**
 * "iPhone", "Chrome on Mac": enough for a coach to tell two devices apart.
 * Derived here so the column never holds free text a client chose.
 */
export function deviceLabel(userAgent: string): string {
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "";
  if (device === "iPhone" || device === "iPad") return device;
  if (device && browser) return `${browser} on ${device}`;
  return device || browser || "This device";
}

const Prefs = z.object({ clips: z.boolean(), replies: z.boolean() });

const SubscribeBody = z.object({
  subscription: z.object({
    endpoint: z.string().refine(isPushEndpoint, "not a push service endpoint"),
    keys: z.object({ p256dh: z.string().refine(isP256dh), auth: z.string().refine(isPushAuth) }),
  }),
  prefs: Prefs.optional(),
});

const EndpointBody = z.object({ endpoint: z.string().refine(isPushEndpoint) });
const PrefsBody = z.object({ prefs: Prefs });

type Ctx = { tables: PushTables; databaseId: string; callerId: string; now: () => Date };

const writeDeps = (ctx: Ctx): WriteDeps => ({ writer: ctx.tables.writer, databaseId: ctx.databaseId, newId: () => "", now: ctx.now });

async function devicesOf(ctx: Ctx) {
  const page = await ctx.tables.listRows({
    databaseId: ctx.databaseId,
    tableId: PUSH_TABLE,
    queries: [Query.equal("user_id", ctx.callerId), Query.limit(100)],
  });
  return page.rows.filter((row) => row.user_id === ctx.callerId);
}

async function deviceAt(ctx: Ctx, rowId: string) {
  const page = await ctx.tables.listRows({
    databaseId: ctx.databaseId,
    tableId: PUSH_TABLE,
    queries: [Query.equal("$id", rowId), Query.limit(1)],
  });
  return page.rows.find((row) => row.$id === rowId) ?? null;
}

export type SubscribeResult = { status: "invalid" } | { status: "saved"; rowId: string; prefs: PushPrefs };

export async function subscribe(ctx: Ctx, body: unknown, userAgent: string): Promise<SubscribeResult> {
  const parsed = SubscribeBody.safeParse(body);
  if (!parsed.success) return { status: "invalid" };
  const { endpoint, keys } = parsed.data.subscription;
  const { rowId, hash } = pushRowId(endpoint);

  const mine = await devicesOf(ctx);
  // A new device takes the coach's existing choices unless it says otherwise:
  // the switches are about what a coach wants to hear, not about which phone.
  const prefs = parsed.data.prefs ?? (mine[0] ? prefsOf(mine[0]) : DEFAULT_PUSH_PREFS);
  const input = { rowId, endpoint, endpointHash: hash, p256dh: keys.p256dh, auth: keys.auth, label: deviceLabel(userAgent), prefs };
  const deps = writeDeps(ctx);
  const actor = { userId: ctx.callerId };

  const existing = mine.find((row) => row.$id === rowId) ?? (await deviceAt(ctx, rowId));
  if (existing && existing.user_id !== ctx.callerId) {
    // The browser is the caller's now: somebody else signed in on it and their
    // sign-out did not reach us. Their row goes, so their notifications stop
    // landing on a device they have left.
    await deletePushSubscription(deps, rowId);
    await createPushSubscription(deps, actor, input);
  } else if (existing) {
    await updatePushSubscription(deps, actor, input);
  } else {
    await createPushSubscription(deps, actor, input);
  }
  return { status: "saved", rowId, prefs };
}

export type PrefsResult = { status: "invalid" } | { status: "saved"; prefs: PushPrefs; devices: number };

/** The switches apply to every device the caller has, for the reason `subscribe` copies them. */
export async function savePrefs(ctx: Ctx, body: unknown): Promise<PrefsResult> {
  const parsed = PrefsBody.safeParse(body);
  if (!parsed.success) return { status: "invalid" };
  const mine = await devicesOf(ctx);
  const deps = writeDeps(ctx);
  for (const row of mine) {
    await setPushPrefs(deps, { userId: ctx.callerId }, { rowId: row.$id as string, prefs: parsed.data.prefs });
  }
  return { status: "saved", prefs: parsed.data.prefs, devices: mine.length };
}

export type UnsubscribeResult = { status: "invalid" } | { status: "removed" | "absent" };

/** One device off. Only the caller's own: an endpoint someone else registered is not theirs to remove. */
export async function unsubscribe(ctx: Ctx, body: unknown): Promise<UnsubscribeResult> {
  const parsed = EndpointBody.safeParse(body);
  if (!parsed.success) return { status: "invalid" };
  const { rowId } = pushRowId(parsed.data.endpoint);
  const row = await deviceAt(ctx, rowId);
  if (!row || row.user_id !== ctx.callerId) return { status: "absent" };
  await deletePushSubscription(writeDeps(ctx), rowId);
  return { status: "removed" };
}

/** "Send a test" to every device the caller has. Dead ones are removed on the way, as the Function does. */
export async function sendTest(ctx: Ctx, send: Send): Promise<DeliverResult & { devices: number }> {
  const targets = (await devicesOf(ctx)).map(targetOf).filter((t) => t !== null);
  const result = await deliver({ send, write: writeDeps(ctx), log: (m) => console.log(`[push/test] ${m}`) }, targets, testMessage(ctx.now()));
  return { ...result, devices: targets.length };
}
