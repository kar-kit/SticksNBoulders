import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { fetchBodyweight } from "@/lib/bodyweight/store";
import { fetchProfile } from "@/lib/profile/profile-store";
import { dotsFor, type DotsResult } from "./dots";
import { fetchEstimatedMaxes, fetchReferenceMaxes } from "./reference-max-store";

/**
 * Everything DOTS needs, in one round of requests.
 *
 * One function for both screens rather than one each, and that is the point of
 * the file. The athlete's Bodyweight screen and the coach's Athlete View show
 * the same number for the same person, so if they assembled it separately they
 * could disagree -- and a coach and athlete looking at different DOTS for the
 * same lifter is the kind of bug that gets discovered in a conversation rather
 * than in a test.
 *
 * Five reads, in parallel. Individually they are each on a screen already;
 * together they are one waterfall if sequenced, and the build plan holds both
 * screens to 2.5s.
 *
 * No branch on who is asking. The coach reads all five through the circle team
 * exactly as the athlete reads them for themselves, so this works unchanged
 * for either and stops working the moment a link is revoked. Nothing here
 * checks a role, which is what makes that true rather than hoped for.
 *
 * Nothing is written. DOTS is not stored on a document and there is no rollup
 * for it: the compute-and-store rule exists because Appwrite cannot aggregate
 * on read, and this is a single division over numbers both screens have
 * already fetched. Storing it would add a second copy to keep true.
 */
export async function fetchDots(athleteId: string): Promise<DotsResult> {
  const [profile, bodyweight, entries, estimated, exercises] = await Promise.all([
    fetchProfile(athleteId),
    fetchBodyweight(athleteId),
    fetchReferenceMaxes(athleteId),
    fetchEstimatedMaxes(athleteId),
    fetchExerciseLibrary(athleteId),
  ]);

  return dotsFor({
    // A profile that has never been written reads as an unanswered sex, which
    // is the same prompt and the same screen. Not an error.
    sex: profile?.sex ?? null,
    bodyweight,
    entries,
    estimated,
    exercises,
    asOf: new Date(),
  });
}
