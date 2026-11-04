import { ThreadLink } from "@/components/coach/thread-link";

export const metadata = { title: "Replies — Sticks N Boulders" };

/**
 * F26: the stable link to one set's thread, `/coach/replies/<setId>`.
 *
 * What push notifications (F27) and anything else outside the app should
 * link to. It names only the set: the page finds whose set it is through the
 * coach's own session, marks the thread read, and hands over to the clip
 * dialog over Athlete View, where threads are read today. So the Athlete
 * View's own URL can change without breaking a notification already sent.
 *
 * It grants nothing. A set the coach cannot read -- gone, never his
 * athlete's, or an athlete who has unlinked -- gets a plain "not available"
 * and a way back to Replies.
 */
export default async function ThreadPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  return <ThreadLink setId={setId} />;
}
