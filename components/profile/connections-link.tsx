"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { mayUseConnections } from "@/lib/api/token-store";

/**
 * The Connections row on Me (F29), drawn only once the server has said this
 * user is on API_TOKEN_USER_IDS. Everyone else never sees it, not even for a
 * frame: it starts hidden and a refusal or a failure leaves it hidden.
 */
export function ConnectionsLink({ userId }: { userId: string }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mayUseConnections(userId)
      .then((ok) => {
        if (!cancelled) setAllowed(ok);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!allowed) return null;
  return (
    <Link
      href="/me/connections"
      className="motion-safe:animate-row-in flex items-center justify-between rounded-control border border-border px-3 py-2.5"
    >
      <span className="text-body">Connections</span>
      <span className="text-ui text-muted">API tokens ›</span>
    </Link>
  );
}
