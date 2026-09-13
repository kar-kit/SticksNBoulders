import { TodayPlaceholder } from "./today-placeholder";

export const metadata = { title: "Today — Sticks N Boulders" };

/**
 * Where sign-in lands. The real Today screen is Order 7; this exists so the
 * auth flow has a destination and so the session can be seen working end to
 * end. FTP1-4 builds the shell around it.
 */
export default function TodayPage() {
  return <TodayPlaceholder />;
}
