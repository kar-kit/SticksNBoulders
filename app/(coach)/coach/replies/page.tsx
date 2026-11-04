import { RepliesInbox } from "@/components/coach/replies-inbox";

export const metadata = { title: "Replies — Sticks N Boulders" };

/**
 * F26: athlete replies to the coach, newest first, with what is unread
 * marked. A client component like the rest of the coach side: the circle team
 * is the permission for the comments, and the coach's own session is the only
 * one that can read his read marks. The state lives in the coach layout's
 * provider (lib/review/coach-replies-context.tsx), shared with the nav badge.
 */
export default function RepliesPage() {
  return <RepliesInbox />;
}
