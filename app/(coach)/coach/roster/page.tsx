import { Roster } from "@/components/coach/roster";

export const metadata = { title: "Roster — Sticks N Boulders" };

/**
 * Order 24, blueprint 10: the coach's landing page. A client component, like
 * the rest of the coach side, because every read goes through the coach's own
 * Appwrite session -- the circle team is the permission, and a server render
 * with the API key would read past it.
 *
 * The screen owns its empty, loading, failed and linked states. The empty one
 * (no athletes, the invite code as its action) is Ruairi's first session.
 */
export default function RosterPage() {
  return <Roster />;
}
