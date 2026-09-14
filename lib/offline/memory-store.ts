import type { QueueStore, QueuedOp } from "./queue";

/**
 * The queue in memory.
 *
 * Used by tests, and as the fallback where IndexedDB is unavailable -- a
 * private window, a browser that blocks storage. Losing the queue on reload is
 * far worse than not having one, but it is still better than refusing to log.
 */
export function createMemoryStore(initial: readonly QueuedOp[] = []): QueueStore {
  const ops = new Map<string, QueuedOp>(initial.map((op) => [op.id, op]));
  return {
    async put(op) {
      ops.set(op.id, op);
    },
    async remove(id) {
      ops.delete(id);
    },
    async all() {
      return [...ops.values()];
    },
  };
}
