/**
 * The write-ahead queue.
 *
 * A lost set is unforgivable and gym signal is bad, so every write is written
 * down durably before it is attempted and only removed once Appwrite has it.
 * Nothing here talks to the network or to IndexedDB -- the store is an
 * interface and the flusher is elsewhere -- so the awkward parts (replay after
 * a reload, a permanently broken op, ordering) are tests rather than opinions.
 *
 * Deliberately not a CRDT. Sets are append-mostly and edited by one person on
 * one device; the row says so, and merge semantics nobody needs would be the
 * most expensive thing in the codebase.
 *
 * There is no local-id-to-server-id mapping anywhere, and that is the point.
 * The client id IS the Appwrite row id: `st-<unique>` is 23 characters of
 * a-z0-9 and a hyphen, which is a legal row id, so a set logged with no signal
 * has its real id the moment it appears on screen. Sets reference their session
 * by an id that exists before the session row does; Appwrite has no foreign
 * keys, so that breaks nothing -- but ops are flushed in order anyway, because
 * a set whose session is missing is a support call.
 *
 * The consequence worth stating: a retry can never write a row twice, because
 * the second attempt carries the same row id as the first. The unique index on
 * client_set_id is now a belt alongside that brace rather than the only thing
 * standing between a dropped response and a duplicated set.
 */

export type OpKind =
  | "session.create"
  | "session.finish"
  | "set.create"
  | "set.update"
  | "set.delete"
  | "set.attachVideo"
  | "exercise.create"
  | "rollup.refresh";

export interface QueuedOp {
  /** Stable across retries. Also the store's key. */
  id: string;
  kind: OpKind;
  /** The write's own arguments, already shaped for the helper that runs it. */
  payload: Record<string, unknown>;
  /** Ordering. Monotonic per device, so a replay keeps the session's shape. */
  sequence: number;
  attempts: number;
  /** Epoch ms before which this op should not be tried again. */
  nextAttemptAt: number;
  /** Set when an op can never succeed, so it stops blocking everything behind it. */
  permanentError?: string;
}

export interface QueueStore {
  put(op: QueuedOp): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<QueuedOp[]>;
}

/**
 * What to do with a write that threw.
 *
 * The distinction matters more than it looks. Without it, one malformed op
 * retries forever at the head of the queue and every set behind it never
 * leaves the device -- a queue that looks busy and is actually dead.
 */
export type Outcome = "done" | "retry" | "permanent";

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

export function classify(error: unknown): Outcome {
  const code = (error as ErrorLike)?.code;
  if (typeof code !== "number") {
    // No status at all is a fetch that never arrived: offline, DNS, a captive
    // portal. Always worth another go.
    return "retry";
  }
  // The idempotency keys are unique-indexed precisely so this means "the first
  // attempt landed and the response was lost on the way back".
  if (code === 409) return "done";
  // 401 is recoverable: a session refreshes, and a missing circle gets created
  // by the next write that needs it. 403 likewise once a link exists.
  if (code === 401 || code === 403 || code === 408 || code === 429) return "retry";
  if (code >= 500) return "retry";
  // 400 and 404 are the shape of the request, not the state of the world.
  // Retrying is how a queue eats itself.
  if (code >= 400) return "permanent";
  return "retry";
}

/** Doubling, capped at a minute. A phone in a basement should not spin. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts) * 1000, 60_000);
}

export function newOp(
  kind: OpKind,
  payload: Record<string, unknown>,
  sequence: number,
  id: string,
  now = Date.now(),
): QueuedOp {
  return { id, kind, payload, sequence, attempts: 0, nextAttemptAt: now };
}

/**
 * The ops to attempt right now: the queue's head, up to the first one still
 * backed off.
 *
 * Strictly the prefix, not every op whose timer has expired. Order is the whole
 * point -- a set must not reach Appwrite before the session it belongs to, and
 * an undo must not overtake the set it removes -- so one op waiting holds the
 * ones behind it. That is only safe because an op that can never succeed is
 * marked permanent and drops out of the line entirely.
 *
 * Permanently failed ops are skipped rather than deleted. They are evidence:
 * something an athlete logged did not reach their coach, and discarding it
 * quietly is the one outcome worse than the failure itself.
 */
export function readyPrefix(ops: readonly QueuedOp[], now = Date.now()): QueuedOp[] {
  const queue = pendingOps(ops);
  const waiting = queue.findIndex((op) => op.nextAttemptAt > now);
  return waiting === -1 ? queue : queue.slice(0, waiting);
}

export function pendingOps(ops: readonly QueuedOp[]): QueuedOp[] {
  return ops.filter((op) => !op.permanentError).sort((a, b) => a.sequence - b.sequence);
}

export function failedOps(ops: readonly QueuedOp[]): QueuedOp[] {
  return ops.filter((op) => Boolean(op.permanentError));
}

/** The op after a failed attempt: either backed off, or marked as never. */
export function afterFailure(op: QueuedOp, outcome: Outcome, error: unknown, now = Date.now()): QueuedOp {
  const attempts = op.attempts + 1;
  if (outcome === "permanent") {
    const message = (error as ErrorLike)?.message;
    return {
      ...op,
      attempts,
      permanentError: typeof message === "string" ? message : "rejected",
    };
  }
  return { ...op, attempts, nextAttemptAt: now + backoffMs(attempts) };
}

/** Client ids still in flight, so the screen can mark those rows pending. */
export function pendingClientIds(ops: readonly QueuedOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of pendingOps(ops)) {
    const id = op.payload.setId ?? op.payload.sessionId;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * Whether an undo can simply delete the queued create instead of queueing a
 * delete behind it.
 *
 * Only when that create has never been attempted. Once it has, the attempt may
 * have landed with the response lost on the way back -- the exact case the
 * idempotent ids exist for -- and dropping it locally would leave a set on the
 * server that the athlete believes they removed.
 */
export function collapsibleCreate(ops: readonly QueuedOp[], kind: OpKind, rowId: string): QueuedOp | null {
  const key = kind === "set.create" ? "setId" : "sessionId";
  return (
    ops.find(
      (op) => op.kind === kind && op.attempts === 0 && !op.permanentError && op.payload[key] === rowId,
    ) ?? null
  );
}

/**
 * Whether a queued rollup refresh has already been made pointless by a later one.
 *
 * Five sets of squats queue five refreshes of one bucket, each recomputing the
 * same week. Only the last matters, because each recomputes from scratch.
 *
 * Skipped here at the front of the queue rather than deduped when enqueued, and
 * the difference is the whole bug it replaces. Collapsing at enqueue keeps the
 * FIRST refresh, which sits in the queue AHEAD of the sets that follow it: it
 * runs, sees one set landed, writes a rollup for one set, and nothing ever
 * recomputes it. The week's totals then sit frozen at whatever had arrived
 * partway through the session. Keeping the last one instead means the surviving
 * refresh runs behind every set it should count.
 */
export function supersededRefresh(ops: readonly QueuedOp[], op: QueuedOp): boolean {
  if (op.kind !== "rollup.refresh") return false;
  return ops.some(
    (other) =>
      other.kind === "rollup.refresh" &&
      other.id !== op.id &&
      !other.permanentError &&
      other.sequence > op.sequence &&
      other.payload.exerciseId === op.payload.exerciseId &&
      other.payload.weekKey === op.payload.weekKey,
  );
}

/**
 * What deleting a set does to the ops still carrying it.
 *
 * `drop` is every op that should simply leave the queue. `landed` says whether
 * the set may exist on the server, and therefore whether a real delete has to
 * be queued behind whatever is left.
 *
 * - A create never attempted, or refused outright (a 400 never lands), cannot
 *   be on the server. It goes, and so does every edit or clip queued against
 *   it -- each would 404 against a row that was never written.
 * - A create that has been tried may have landed with the response lost, the
 *   case the idempotent ids exist for. It stays, and the delete runs behind it.
 * - An edit or clip that has never been tried is pointless once the set is
 *   going, so it goes. One that has been tried may have landed; harmless,
 *   because the delete behind it removes the row either way.
 *
 * `inFlight` is the op the drain loop is sending right now. It is treated as
 * attempted whatever its counter says: dropping it locally while the request
 * is on the wire is how a deleted set turns up on the coach's side anyway.
 */
export function opsDroppedByDelete(
  ops: readonly QueuedOp[],
  setId: string,
  inFlight: string | null = null,
): { drop: QueuedOp[]; landed: boolean } {
  const mine = ops.filter((op) => op.payload.setId === setId);
  const tried = (op: QueuedOp) => op.attempts > 0 || op.id === inFlight;

  const create = mine.find((op) => op.kind === "set.create");
  const landed = !create || (tried(create) && !create.permanentError);

  const drop = mine.filter((op) => {
    if (op.kind === "set.create") return !landed;
    if (op.kind === "set.update" || op.kind === "set.attachVideo") {
      return !landed || Boolean(op.permanentError) || !tried(op);
    }
    return false;
  });
  return { drop, landed };
}
