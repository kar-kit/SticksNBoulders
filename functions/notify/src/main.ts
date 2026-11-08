import { restTables } from "../../../appwrite/documents/rest-tables";
import type { Row } from "../../../appwrite/documents/provenance";
import type { RowWriter } from "../../../appwrite/documents/row-writer";
import { dispatch } from "../../../lib/push/dispatch";
import { vapidFromEnv, webPushSender } from "../../../lib/push/web-push-sender";

/**
 * notify: tells a coach, on their phone or laptop, that an athlete put up a
 * clip or answered in a thread (F27). docs/push-notifications.md.
 *
 * Fires on a set being created or updated and on a comment being created,
 * both event spellings (docs/appwrite-events.md). What counts is decided in
 * lib/push -- `classifyEvent` for which events, `recipientsFor` for which
 * coaches, the service worker for collapsing -- so this file is wiring.
 *
 * It never fails an execution. The functions worker runs every Function
 * matching an event in a loop and a failed one re-throws out of it, taking
 * every later-created Function on the same event down too
 * (docs/appwrite-events.md). A missed notification is a shrug; a validator
 * that stopped running because this one threw is a security bug. So every
 * error is logged and answered 200.
 *
 * Kill switch: NOTIFY_DRY_RUN=true classifies and logs, sends nothing. To
 * switch it off entirely, clear its events, not `enabled`.
 */

interface Context {
  req: { headers: Record<string, string>; body: unknown; bodyText?: string; bodyJson?: unknown };
  res: { json: (body: unknown, status?: number) => unknown };
  log: (message: string) => void;
  error: (message: string) => void;
}

function parseRow(req: Context["req"]): Row | null {
  const body = req.bodyJson ?? req.body;
  if (body && typeof body === "object") return body as Row;
  const text = typeof body === "string" ? body : (req.bodyText ?? "");
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Row) : null;
  } catch {
    return null;
  }
}

const DRY_WRITER: RowWriter = {
  createRow: async ({ rowId }) => ({ $id: rowId }),
  updateRow: async ({ rowId }) => ({ $id: rowId }),
  deleteRow: async () => ({}),
};

export default async function main({ req, res, log, error }: Context) {
  const trigger = req.headers["x-appwrite-trigger"];
  if (trigger !== "event") return res.json({ action: "skip", reason: `not an event (${trigger ?? "no trigger"})` });

  const row = parseRow(req);
  const event = req.headers["x-appwrite-event"] ?? "";
  if (!row) return res.json({ action: "skip", reason: "no row in the event body" });

  const vapid = vapidFromEnv(process.env);
  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || "";
  const project = process.env.APPWRITE_FUNCTION_PROJECT_ID || "";
  const key = req.headers["x-appwrite-key"] || "";
  const databaseId = typeof row.$databaseId === "string" ? row.$databaseId : "";
  if (!vapid || !endpoint || !project || !key || !databaseId) {
    error("notify is missing VAPID variables, endpoint, project, key or database; nothing sent");
    return res.json({ action: "skip", reason: "not configured" });
  }

  const dryRun = process.env.NOTIFY_DRY_RUN === "true";
  const tables = restTables({ endpoint, project, key, databaseId });
  try {
    const result = await dispatch(
      {
        reader: tables,
        // A dry run writes nothing either: no timestamp, no removed device.
        write: { writer: dryRun ? DRY_WRITER : tables.writer, databaseId, newId: () => "", now: () => new Date() },
        send: dryRun ? async () => ({ statusCode: 201 }) : webPushSender(vapid),
        now: () => new Date(),
        log,
      },
      event,
      row,
    );
    log(`${event}: ${JSON.stringify(result)}${dryRun ? " (dry run, nothing sent)" : ""}`);
    return res.json({ ...result, dryRun });
  } catch (caught) {
    error(`${event}: ${caught instanceof Error ? caught.message : String(caught)}`);
    return res.json({ action: "skip", reason: "failed, logged" });
  }
}
