import { ClipDetail } from "./clip-detail";

export const metadata = { title: "Clip — Sticks N Boulders" };

/**
 * One of the athlete's own clips (F13), opened from History → Clips. A route
 * rather than a dialog, so Back, deep links and the F7 push all work as they
 * do for a session. The id grants nothing: a set that is not the signed-in
 * athlete's opens the same "not found" as one that does not exist.
 */
export default async function ClipPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  return <ClipDetail setId={setId} />;
}
