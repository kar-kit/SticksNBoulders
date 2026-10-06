/**
 * When to ask an athlete for a clip the coach marked as required (Order 30).
 *
 * The problem is forgetting to film, not attaching, so the answer is a nudge
 * at the moment forgetting happens: the line's sets are done and no clip
 * exists. It is never a gate. Nothing here can stop a set confirming or a
 * session finishing -- offline is normal, and speed is a feature.
 *
 * Pure. No client, no network, no clock of its own.
 */

/** The slice of a prescription line this needs. */
export interface VideoLine {
  setCount: number;
  videoRequired?: boolean;
  /**
   * Backoff sets the line's rule adds after its own sets right now (Order 21),
   * from `targetsFor`. They take positions like any other set, so a flagged
   * line after them starts later; a flagged line WITH a backoff is done after
   * its own sets, because the clip the coach wants is of the top set.
   */
  backoffSets?: number;
}

export type VideoAsk =
  /** Nothing requested, or the clip is already there. */
  | "none"
  /** Requested: the camera button stands out while the sets are still being done. */
  | "emphasise"
  /** Requested, every set of the flagged line logged, still no clip: say so once. */
  | "prompt";

/**
 * Where an exercise stands against a coach's video request.
 *
 * `lines` are one exercise's prescription lines in the order the coach wrote
 * them. Logged working sets fill them in that order -- the same positional rule
 * `targetsFor` uses to price a set -- so a flagged top set is "done" after
 * set 1 even if the backoffs after it are not.
 *
 * `hasClip` is any clip on any set of the exercise, not just the latest: the
 * camera attaches to the most recent set, so a clip filmed on set 1 must not
 * be asked for again when set 3 lands.
 */
export function videoAsk(input: {
  lines: readonly VideoLine[] | null | undefined;
  loggedWorking: number;
  hasClip: boolean;
}): VideoAsk {
  const { lines, loggedWorking, hasClip } = input;
  if (!lines || hasClip) return "none";

  let end = 0;
  let flaggedEnd = 0;
  for (const line of lines) {
    end += line.setCount;
    if (line.videoRequired) flaggedEnd = end;
    end += line.backoffSets ?? 0;
  }
  if (flaggedEnd === 0) return "none";
  return loggedWorking >= flaggedEnd ? "prompt" : "emphasise";
}
