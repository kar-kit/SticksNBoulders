"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { parseKg } from "@/lib/coach/athlete-view";
import type { LoadPreview } from "@/lib/programming/editor";
import { kindLabel } from "@/lib/strength/reference-max";
import { setReferenceMax } from "@/lib/strength/reference-max-store";

/**
 * The line under a load cell that says what the athlete will get: the kilos
 * and the max they came from, or why there are none -- and, when a max is
 * what is missing, an "Add one" that sets it right here.
 *
 * "Add one" writes through /api/reference-max (`setReferenceMax`), the same
 * call CURRENT MAXES on Athlete View makes, so the route's checks (the caller
 * coaches this athlete, the number is plausible) are the only ones there are.
 * It takes effect from now; a max for next block is still set on Athlete
 * View, where its date can be picked.
 *
 * `compact` is the progression grid's cell: the first clause only, the rest
 * in the title, and no form -- there is no room in a cell to type a max.
 */
export function LoadPreviewLine({
  preview,
  athleteId,
  editable,
  compact = false,
  onMaxAdded,
}: {
  preview: LoadPreview | null;
  /** Null on a template: nobody's max to add. */
  athleteId: string | null;
  editable: boolean;
  compact?: boolean;
  onMaxAdded?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!preview) return null;

  const tone =
    preview.tone === "resolved" ? "text-foreground" : preview.tone === "missing" ? "text-danger-line" : "text-muted";
  const kind = preview.tone === "missing" ? "unresolved" : preview.tone;
  const shown = compact ? (preview.text.split(" · ")[0] ?? preview.text) : preview.text;
  const add = preview.addMax;
  const field = add ? `${add.name} ${kindLabel(add.kind)}, kg` : "";

  const save = async (raw: string) => {
    if (!add || !athleteId) return;
    const valueKg = parseKg(raw);
    if (valueKg === null) return setError("A max is a weight, like 182.5");
    setSaving(true);
    setError(null);
    try {
      await setReferenceMax({ athleteId, exerciseId: add.exerciseId, kind: add.kind, valueKg });
      setAdding(false);
      onMaxAdded?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That max did not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="block px-1 pt-0.5">
      <span className={cn("text-caption tabular-nums", tone)} data-kind={kind} title={compact ? preview.text : undefined}>
        {shown}
      </span>
      {!compact && add && editable && athleteId && !adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="ml-1 rounded-chip px-1 text-caption font-semibold text-accent-fill underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent-line"
        >
          Add one
        </button>
      ) : null}
      {!compact && adding && add ? (
        <span className="mt-1 flex items-center gap-1">
          <input
            aria-label={field}
            inputMode="decimal"
            placeholder="kg"
            autoFocus
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save(e.currentTarget.value);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setAdding(false);
                setError(null);
              }
            }}
            className="h-7 w-20 rounded-control border border-border bg-surface-2 px-2 text-caption text-foreground tabular-nums focus:border-accent-line focus:outline-none"
          />
          <span className="text-caption text-muted-2">Enter saves, from today</span>
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="block text-caption text-danger-line">
          {error}
        </span>
      ) : null}
    </span>
  );
}
