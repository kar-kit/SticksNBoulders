"use client";

import { useEffect, useState } from "react";
import { fetchDayLabels } from "@/lib/programming/program-store";

/**
 * Program day labels for the sessions on screen, keyed by day id.
 *
 * A failed read leaves the map empty, so the sessions show their date: the
 * label is a nicer title, never the only one.
 */
export function useDayLabels(dayIds: readonly (string | null | undefined)[]): Map<string, string> {
  const key = [...new Set(dayIds.filter((id): id is string => Boolean(id)))].sort().join(",");
  const [labels, setLabels] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void (async () => {
      const loaded = await fetchDayLabels(key.split(",")).catch(() => new Map<string, string>());
      if (!cancelled) setLabels(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return labels;
}
