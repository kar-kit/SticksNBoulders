import { cascadeFor, verdictFor, type Cascade, type Row } from "../../../appwrite/documents/provenance";

/**
 * validate-row: the server half of the 27 Sep 2026 forgery fix.
 *
 * Fires on every row create and update in the database. If the row is in a
 * table a session can write, and its stored permissions do not prove the
 * owner it names wrote it, the row is deleted. The judgment is
 * `verdictFor` in appwrite/documents/provenance.ts -- the same code every
 * reader uses to decide what to trust -- bundled in here by esbuild at deploy
 * time, so there is one definition and not a copy.
 *
 * Deletes rather than reverts, on updates too. The event carries the row as
 * it is now and nothing about how it was, so there is nothing to revert to;
 * and a row whose owner fields its stamp cannot vouch for is a false claim
 * whatever it said a moment ago. The only honest row this can hit is one its
 * owner relabelled with somebody else's id, and that owner loses one set of
 * their own.
 *
 * What keeps a bug here from being a mass delete: it acts on one row per
 * event, only in client-writable tables, only when the row names an owner
 * and lacks that owner's proof. A stale read stamp from an older policy is
 * not grounds (see verdictFor). And VALIDATOR_DRY_RUN=true makes it a logger.
 *
 * No SDK. The one call it makes is a DELETE with the per-execution key, and
 * bundling node-appwrite to make it would be most of the deployment. The cost
 * of no SDK is a hand-written route, which is how this shipped calling one
 * that does not exist (6 Oct 2026): keep it on `/tablesdb/`.
 *
 * Since F25 it also hears one kind of delete: a comment's. The reactions on
 * a comment were written by the other party and only they may delete them,
 * so the comment's author cannot take them along when withdrawing it; this
 * does, with the per-execution key (`cascadeFor` in provenance.ts). It lists
 * by the deleted comment's own id, in one table, and deletes what it finds.
 * Readers never show a reaction whose comment is gone, so a cascade that
 * fails costs a few orphan rows, not a wrong screen.
 */

interface Context {
  req: { headers: Record<string, string>; body: unknown; bodyText?: string; bodyJson?: unknown };
  res: { json: (body: unknown, status?: number) => unknown };
  log: (message: string) => void;
  error: (message: string) => void;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

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

export default async function main({ req, res, log, error }: Context) {
  const trigger = req.headers["x-appwrite-trigger"];
  if (trigger !== "event") {
    return res.json({ action: "skip", reason: `not an event (${trigger ?? "no trigger"})` });
  }

  const row = parseRow(req);
  if (!row) {
    error("event carried no row");
    return res.json({ action: "skip", reason: "no row in the event body" }, 400);
  }

  const tableId = str(row.$tableId) || str(row.$collectionId);
  const databaseId = str(row.$databaseId);
  const rowId = str(row.$id);
  const event = req.headers["x-appwrite-event"] ?? "";

  if (event.endsWith(".delete")) {
    return cascade({ res, log, error }, tableId, databaseId, rowId, cascadeFor(tableId, row), req.headers["x-appwrite-key"] || "");
  }

  const verdict = verdictFor(tableId, row);
  const summary = `${tableId}/${rowId} (${req.headers["x-appwrite-event"] ?? "?"}): ${verdict.action} -- ${verdict.reason}`;

  if (verdict.action !== "delete") {
    log(summary);
    return res.json({ ...verdict, tableId, rowId });
  }

  if (process.env.VALIDATOR_DRY_RUN === "true") {
    log(`DRY RUN, would delete ${summary}`);
    return res.json({ ...verdict, tableId, rowId, dryRun: true });
  }

  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || "";
  const project = process.env.APPWRITE_FUNCTION_PROJECT_ID || "";
  const key = req.headers["x-appwrite-key"] || "";
  if (!endpoint || !project || !key || !databaseId || !rowId) {
    error(`cannot delete ${summary}: missing endpoint/project/key/database/id`);
    return res.json({ ...verdict, tableId, rowId, deleted: false }, 500);
  }

  // The TablesDB route. `/databases/{db}/tables/...` is not a route on 1.9.6:
  // it 404s as general_route_not_found, and until 6 Oct 2026 that 404 was read
  // as "already deleted", so every forgery was logged deleted and kept.
  const response = await fetch(
    `${endpoint}/tablesdb/${encodeURIComponent(databaseId)}/tables/${encodeURIComponent(tableId)}/rows/${encodeURIComponent(rowId)}`,
    { method: "DELETE", headers: { "x-appwrite-project": project, "x-appwrite-key": key } },
  );
  if (response.ok) {
    log(`deleted ${summary}`);
    return res.json({ ...verdict, tableId, rowId, deleted: true });
  }
  const body = await response.text();
  // A second execution (both event spellings fired) got there first. Only the
  // row's own not-found counts; any other 404 means the request missed.
  if (response.status === 404 && isRowNotFound(body)) {
    log(`already gone ${summary}`);
    return res.json({ ...verdict, tableId, rowId, deleted: true });
  }
  error(`delete failed ${response.status} for ${summary}: ${body.slice(0, 300)}`);
  return res.json({ ...verdict, tableId, rowId, deleted: false }, 500);
}

/** Most reactions one comment can carry: one per person in the circle. A page is plenty. */
const CASCADE_PAGE = 100;

/**
 * The reactions on a deleted comment, removed.
 *
 * Listed rather than derived: a reaction's id is a client id, and who reacted
 * -- the athlete, or any coach in their circle -- is not on the comment. The
 * query is spelled exactly as the SDK spells `Query.equal` and `Query.limit`
 * (`queries[0]=<json>`), and validate-row.test.ts pins it against the SDK's own
 * output, because a hand-written route is how this Function once called one
 * that did not exist.
 */
async function cascade(
  { res, log, error }: Pick<Context, "res" | "log" | "error">,
  tableId: string,
  databaseId: string,
  rowId: string,
  plan: Cascade | null,
  key: string,
) {
  const summary = `${tableId}/${rowId} deleted`;
  if (!plan) {
    log(`${summary}: nothing cascades from ${tableId || "an unknown table"}`);
    return res.json({ action: "skip", reason: `nothing cascades from ${tableId}`, tableId, rowId });
  }
  if (process.env.VALIDATOR_DRY_RUN === "true") {
    log(`DRY RUN, would delete ${plan.tableId} where ${plan.column} = ${plan.value} (${summary})`);
    return res.json({ action: "cascade", tableId, rowId, cascade: plan, dryRun: true });
  }
  const endpoint = process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || "";
  const project = process.env.APPWRITE_FUNCTION_PROJECT_ID || "";
  if (!endpoint || !project || !key || !databaseId) {
    error(`cannot cascade ${summary}: missing endpoint/project/key/database`);
    return res.json({ action: "cascade", tableId, rowId, deleted: 0 }, 500);
  }
  const headers = { "x-appwrite-project": project, "x-appwrite-key": key };
  const rows = `${endpoint}/tablesdb/${encodeURIComponent(databaseId)}/tables/${encodeURIComponent(plan.tableId)}/rows`;

  const listed = await fetch(`${rows}?${cascadeQuery(plan)}`, { method: "GET", headers });
  if (!listed.ok) {
    error(`cascade list failed ${listed.status} for ${summary}: ${(await listed.text()).slice(0, 300)}`);
    return res.json({ action: "cascade", tableId, rowId, deleted: 0 }, 500);
  }
  const page = (await listed.json().catch(() => ({}))) as { rows?: unknown };
  const ids = (Array.isArray(page.rows) ? page.rows : [])
    // Belt and braces on the query: only rows that really name this comment.
    .filter((r): r is Row => Boolean(r) && typeof r === "object" && (r as Row)[plan.column] === plan.value)
    .map((r) => str(r.$id))
    .filter(Boolean);

  let deleted = 0;
  for (const id of ids) {
    const response = await fetch(`${rows}/${encodeURIComponent(id)}`, { method: "DELETE", headers });
    const gone = response.ok || (response.status === 404 && isRowNotFound(await response.text()));
    if (gone) deleted += 1;
    else error(`cascade delete failed ${response.status} for ${plan.tableId}/${id}`);
  }
  log(`${summary}: removed ${deleted}/${ids.length} from ${plan.tableId}`);
  return res.json({ action: "cascade", tableId, rowId, cascade: plan, deleted }, deleted === ids.length ? 200 : 500);
}

/** `queries[0]=equal(column, value)&queries[1]=limit(page)`, as the SDK sends a GET. */
export function cascadeQuery(plan: Cascade): string {
  const params = new URLSearchParams();
  params.append("queries[0]", JSON.stringify({ method: "equal", attribute: plan.column, values: [plan.value] }));
  params.append("queries[1]", JSON.stringify({ method: "limit", values: [CASCADE_PAGE] }));
  return params.toString();
}

/** Appwrite's error type for a missing row, under either API's name. */
export function isRowNotFound(body: string): boolean {
  try {
    const type = (JSON.parse(body) as { type?: unknown }).type;
    return type === "row_not_found" || type === "document_not_found";
  } catch {
    return false;
  }
}
