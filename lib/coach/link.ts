/**
 * What redeeming a code should do, decided as pure logic.
 *
 * This is the branch that governs who can read an athlete's training, so it is
 * separated from everything that talks to Appwrite and tested exhaustively.
 * A wrong answer here is not a display bug: it is either a coach who cannot see
 * their athlete, or a stranger who can.
 *
 * The caller supplies the athlete's existing links and the coach the code
 * resolved to; this decides, and the caller carries it out.
 */

export interface ExistingLink {
  rowId: string;
  coachId: string;
  status: "active" | "revoked";
}

export type Redemption =
  /** The code was the athlete's own. */
  | { kind: "self" }
  /** Already linked to this coach. Redeeming again changes nothing. */
  | { kind: "already-linked"; coachId: string }
  /**
   * Linked to somebody else. Refused rather than added: an athlete has one
   * coach in the MVP, and quietly granting a second one access to a training
   * history is the failure this whole module exists to prevent.
   */
  | { kind: "other-coach"; coachId: string }
  /** Linked to this coach before and revoked. The row is reused. */
  | { kind: "reactivate"; rowId: string; coachId: string }
  /** A first link. */
  | { kind: "create"; coachId: string };

export function decideRedemption(
  athleteId: string,
  coachId: string,
  existing: readonly ExistingLink[],
): Redemption {
  if (!athleteId) throw new Error("decideRedemption: athleteId is required");
  if (!coachId) throw new Error("decideRedemption: coachId is required");

  // Checked before anything else. A coach redeeming their own code would
  // otherwise be added to their own circle, and circle-admin refuses that --
  // better to answer it here than to fail halfway through a write.
  if (coachId === athleteId) return { kind: "self" };

  const active = existing.find((link) => link.status === "active");
  if (active) {
    return active.coachId === coachId
      ? { kind: "already-linked", coachId }
      : { kind: "other-coach", coachId: active.coachId };
  }

  const revoked = existing.find((link) => link.coachId === coachId && link.status === "revoked");
  // The unique index on (coach_id, athlete_id) means a revoked pair cannot be
  // created a second time. Reusing the row is not an optimisation, it is the
  // only thing Appwrite will accept.
  if (revoked) return { kind: "reactivate", rowId: revoked.rowId, coachId };

  return { kind: "create", coachId };
}

export type Unlink =
  /** Nothing to withdraw. Two devices, two taps -- a success, not an error. */
  | { kind: "not-linked" }
  | { kind: "revoke"; rowId: string; coachId: string };

/**
 * What withdrawing access should do.
 *
 * The mirror of decideRedemption, and pure for the same reason: this decides
 * whether somebody keeps being able to read a training history.
 */
export function decideUnlink(athleteId: string, existing: readonly ExistingLink[]): Unlink {
  if (!athleteId) throw new Error("decideUnlink: athleteId is required");
  const active = existing.find((link) => link.status === "active");
  return active ? { kind: "revoke", rowId: active.rowId, coachId: active.coachId } : { kind: "not-linked" };
}

/**
 * The sentence an athlete agrees to, naming the coach.
 *
 * Here rather than in the component because it is the wording consent is given
 * to: under UK GDPR this is the moment that has to be defensible, and a
 * sentence that lives in one place can be reviewed as one sentence.
 */
export function linkConsentSentence(coachName: string): string {
  const who = coachName.trim() || "Your coach";
  return `${who} will be able to see your sessions, your videos and your bodyweight, and set your training program.`;
}

/**
 * What stops, naming the coach. The mirror of the linking sentence.
 *
 * Under UK GDPR consent has to be as easy to withdraw as it was to give, which
 * means withdrawing it gets the same treatment: named, specific, and on screen
 * before anything happens -- not a bare "Are you sure?".
 */
export function unlinkConsequenceSentence(coachName: string): string {
  const who = coachName.trim() || "Your coach";
  return `${who} will no longer see your sessions, your videos or your bodyweight, and won't be able to set your training program. Your own training stays exactly as it is.`;
}

/** "linked 2 Sep", per the blueprint. */
export function linkedDateLabel(at: Date): string {
  if (Number.isNaN(at.getTime())) return "";
  return `linked ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
