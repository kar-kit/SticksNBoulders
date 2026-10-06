import Link from "next/link";

export const metadata = { title: "No signal — Sticks N Boulders" };

/**
 * What the service worker serves for a screen it has no copy of, with no
 * signal. Only screens that read someone's history by id land here -- Today,
 * Log, History and Me all open offline -- so this states the fact and points
 * back at the ones that work. Offline is normal, not an error: no red, no icon.
 *
 * Static and identical for everyone, so it is safe to cache.
 */
export default function OfflinePage() {
  return (
    <main className="pt-safe-8 flex min-h-dvh flex-col gap-5 bg-background px-4 pb-6">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-display font-semibold">No signal</h1>
        <p className="m-0 text-body text-muted">
          This screen needs a connection. Logging does not — sets save on the phone and send when you are back online.
        </p>
      </header>
      <div className="mt-auto flex flex-col gap-3">
        <Link
          href="/log"
          className="inline-flex h-14 items-center justify-center rounded-control bg-accent-fill px-[22px] text-title font-bold text-on-accent"
        >
          Go to Log
        </Link>
        <Link
          href="/today"
          className="inline-flex h-12 items-center justify-center rounded-control border border-border bg-surface px-[22px] text-action font-medium text-foreground"
        >
          Today
        </Link>
      </div>
    </main>
  );
}
