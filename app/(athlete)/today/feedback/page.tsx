import { FeedbackScreen } from "./feedback-screen";

export const metadata = { title: "Coach feedback — Sticks N Boulders" };

/**
 * Under Today rather than on the tab bar. Four tabs, no more; Today's tab
 * carries the unread dot instead, and stays lit while this is open.
 */
export default function FeedbackPage() {
  return <FeedbackScreen />;
}
