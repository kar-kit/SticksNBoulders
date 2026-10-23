import { Suspense } from "react";
import { HistoryScreen } from "./history-screen";

export const metadata = { title: "History — Sticks N Boulders" };

/**
 * `?view=clips` (F13) is read on the client with useSearchParams, hence the
 * Suspense boundary: the page stays static, so the service worker's cached
 * copy of /history serves either view, and the client picks from the URL.
 */
export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
          <h1 className="m-0 text-display font-semibold">History</h1>
        </div>
      }
    >
      <HistoryScreen />
    </Suspense>
  );
}
