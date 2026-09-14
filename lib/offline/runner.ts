"use client";

import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import {
  createExercise,
  createSession,
  createSet,
  deleteSet,
  finishSession,
  type Actor,
} from "@/appwrite/documents";
import { ensureMyCircle } from "@/lib/auth/circle";
import { refreshRollup } from "@/lib/strength/rollup-client";
import type { QueuedOp } from "./queue";

/**
 * Turning a queued op back into the write it was.
 *
 * The only place the four offline writes touch Appwrite. Everything above this
 * deals in ops; everything below is the ordinary document helper, unchanged --
 * the queue did not get its own write path, which is the property that keeps
 * permission stamping in one reviewed file.
 */

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);
const asDate = (value: unknown): Date => new Date(asString(value));

/**
 * Runs one op. Throws whatever Appwrite threw, for `classify` to read.
 *
 * The circle is ensured first, every time. It is memoised after the first
 * success, so this costs one promise read -- and without it the first write
 * after a cold load comes back 401, because Appwrite rejects a team permission
 * from someone the team has never heard of.
 */
export async function runOp(actor: Actor, op: QueuedOp): Promise<void> {
  await ensureMyCircle();
  const p = op.payload;

  switch (op.kind) {
    case "session.create": {
      const sessionId = asString(p.sessionId);
      await createSession(browserWriteDeps(() => sessionId), actor, {
        clientSessionId: sessionId,
        startedAt: asDate(p.startedAt),
      });
      return;
    }
    case "session.finish": {
      const sessionId = asString(p.sessionId);
      await finishSession(browserWriteDeps(() => sessionId), actor, {
        sessionId,
        finishedAt: asDate(p.finishedAt),
        setCount: asNumber(p.setCount),
        tonnageKg: asNumber(p.tonnageKg),
      });
      return;
    }
    case "set.create": {
      const setId = asString(p.setId);
      await createSet(browserWriteDeps(() => setId), actor, {
        sessionId: asString(p.sessionId),
        exerciseId: asString(p.exerciseId),
        setIndex: asNumber(p.setIndex),
        loadKg: asNumber(p.loadKg),
        reps: asNumber(p.reps),
        rpe: typeof p.rpe === "number" ? p.rpe : null,
        isWarmup: p.isWarmup === true,
        clientSetId: setId,
        loggedAt: asDate(p.loggedAt),
        // e1RM is computed and stored at write time from Order 11, and the
        // rebuild script backfills every set once the formula is verified.
      });
      return;
    }
    case "exercise.create": {
      const exerciseId = asString(p.exerciseId);
      await createExercise(browserWriteDeps(() => exerciseId), actor, { name: asString(p.name) });
      return;
    }
    case "rollup.refresh": {
      // Not a row write, so it does not go through the document helper: the
      // server route does, on the other side. It is an op rather than a
      // fire-and-forget call because a rollup that silently fails to update
      // looks exactly like a correct one, and the queue is what makes a failure
      // retry and, eventually, show up.
      await refreshRollup(asString(p.exerciseId), asString(p.loggedAt));
      return;
    }
    case "set.delete": {
      await deleteSet(browserWriteDeps(() => ""), actor, asString(p.setId));
      return;
    }
  }
}
