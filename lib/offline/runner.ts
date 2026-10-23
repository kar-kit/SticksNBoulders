"use client";

import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import {
  createExercise,
  createSession,
  createSet,
  attachVideo,
  deleteExercise,
  deleteSession,
  deleteSet,
  finishSession,
  renameExercise,
  updateSession,
  updateSet,
  posterIdFor,
  type Actor,
} from "@/appwrite/documents";
import { ensureMyCircle } from "@/lib/auth/circle";
import { ensureMyProfile } from "@/lib/profile/profile-store";
import { refreshRollup } from "@/lib/strength/rollup-client";
import { fetchCommentsForSets } from "@/lib/review/comment-store";
import { exerciseInUse } from "@/lib/exercises/usage-store";
import { sessionHasSets } from "@/lib/logging/history-store";
import { deleteClipIfUnused } from "@/lib/video/clip-cleanup";
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
const isNotFound = (error: unknown): boolean => (error as { code?: unknown })?.code === 404;

/**
 * Runs one op. Throws whatever Appwrite threw, for `classify` to read.
 *
 * The circle is ensured first, every time. It is memoised after the first
 * success, so this costs one promise read -- and without it the first write
 * after a cold load comes back 401, because Appwrite rejects a team permission
 * from someone the team has never heard of.
 *
 * The profile is ensured beside it, and is deliberately allowed to fail. It is
 * not a precondition of writing anything -- it is what makes this athlete have
 * a NAME, which `fetchAthleteNames` reads for the coach's rail and the Review
 * Queue. Before Order 35 nothing ever created one, so every athlete showed up
 * to their coach as "Unnamed athlete". Here because this is the moment an
 * athlete first writes something a coach will read, and a set arriving from
 * nobody is the state this prevents.
 */
export async function runOp(actor: Actor, op: QueuedOp): Promise<void> {
  await ensureMyCircle();
  // Not awaited into the failure path: a profile that cannot be written must
  // never stop a set from being logged.
  void ensureMyProfile().catch(() => {});
  const p = op.payload;

  switch (op.kind) {
    case "session.create": {
      const sessionId = asString(p.sessionId);
      await createSession(browserWriteDeps(() => sessionId), actor, {
        clientSessionId: sessionId,
        startedAt: asDate(p.startedAt),
        programDayId: asString(p.programDayId) || null,
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
        prescriptionId: asString(p.prescriptionId) || null,
        prescribed: asString(p.prescribed) || null,
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
    case "set.update": {
      const setId = asString(p.setId);
      await updateSet(browserWriteDeps(() => setId), actor, {
        rowId: setId,
        loadKg: asNumber(p.loadKg),
        reps: asNumber(p.reps),
        rpe: typeof p.rpe === "number" ? p.rpe : null,
        isWarmup: p.isWarmup === true,
        // The athlete's note (F11), only when the edit carried one: a key
        // that is absent leaves the column alone, null clears it.
        ...("notes" in p && { notes: typeof p.notes === "string" ? p.notes : null }),
      });
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
      const setId = asString(p.setId);
      try {
        await deleteSet(browserWriteDeps(() => ""), actor, setId, {
          // Checked here, at the last moment before the row goes, rather than
          // when the athlete tapped: a delete queued in a basement may run an
          // hour later, after the coach has watched the clip.
          othersCommented: async () =>
            (await fetchCommentsForSets([setId])).some((comment) => comment.authorId !== actor.userId),
        });
      } catch (error) {
        // Already gone is what a delete wants. It happens when the athlete
        // deleted the same set from History on another device, or a first
        // attempt landed with the response lost.
        if (isNotFound(error)) return;
        throw error;
      }
      return;
    }
    case "session.update": {
      const sessionId = asString(p.sessionId);
      // Each field only when the op carries it: a rename must not clear the
      // notes, and a totals refresh must not clear the name.
      await updateSession(browserWriteDeps(() => sessionId), actor, {
        sessionId,
        ...("name" in p && { name: typeof p.name === "string" ? p.name : null }),
        ...("notes" in p && { notes: typeof p.notes === "string" ? p.notes : null }),
        ...(typeof p.setCount === "number" &&
          typeof p.tonnageKg === "number" && { totals: { setCount: p.setCount, tonnageKg: p.tonnageKg } }),
      });
      return;
    }
    case "session.delete": {
      const sessionId = asString(p.sessionId);
      try {
        await deleteSession(browserWriteDeps(() => ""), actor, sessionId, {
          // The set deletes ran in front of this. Any set still there had its
          // delete refused -- a coach commented on it -- and keeps its session.
          setsRemain: () => sessionHasSets(sessionId),
        });
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      return;
    }
    case "exercise.rename": {
      const exerciseId = asString(p.exerciseId);
      await renameExercise(browserWriteDeps(() => exerciseId), actor, { rowId: exerciseId, name: asString(p.name) });
      return;
    }
    case "exercise.delete": {
      const exerciseId = asString(p.exerciseId);
      try {
        await deleteExercise(browserWriteDeps(() => ""), actor, exerciseId, {
          inUse: () => exerciseInUse(actor.userId, exerciseId),
        });
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      return;
    }
    case "clip.delete": {
      // Not a row write: a file in storage, deleted with the athlete's own
      // session, which the file's stamp allows and the coach's does not.
      await deleteClipIfUnused(asString(p.setId), asString(p.fileId));
      return;
    }
    case "set.attachVideo": {
      // The upload already happened; this is the durable record of it. Null is
      // a real value here -- detaching a clip has to clear the id, not leave
      // it pointing at a file that is gone.
      const videoFileId = typeof p.videoFileId === "string" ? p.videoFileId : null;
      // The poster (F12) is checked here rather than trusted: `attachVideo`
      // refuses a poster that is not this clip's own with a plain Error, which
      // the queue classifies as retryable -- one bad payload would wedge every
      // set queued behind it. A poster that does not match is dropped and the
      // clip still attaches; a clip without a thumbnail is the fallback anyway.
      const videoPosterId =
        videoFileId !== null && p.videoPosterId === posterIdFor(videoFileId) ? posterIdFor(videoFileId) : null;
      try {
        await attachVideo(browserWriteDeps(() => ""), actor, {
          rowId: asString(p.setId),
          videoFileId,
          videoPosterId,
        });
      } catch (error) {
        // The set was deleted while its clip was still uploading. There is
        // nothing to attach to, and a permanent failure here would tell the
        // athlete a set did not reach their coach when they removed it on
        // purpose. The file is left for the orphan sweep, like any detach.
        if (isNotFound(error)) return;
        throw error;
      }
      return;
    }
  }
}
