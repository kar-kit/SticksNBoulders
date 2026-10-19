"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { rangeLabel, weekIndexOf, weekRange } from "@/lib/programming/calendar";
import { bumpPlan, isNoBump, parseBump, type Bump } from "@/lib/programming/bump";
import type { BlockTree, ProgramTree, WeekTree } from "@/lib/programming/program";

/**
 * "Duplicate with a bump…": a copy of the week at the end of its block, with
 * every load stepped by +kg, +% or +RPE, and before it is written, a preview
 * of where the copy lands and exactly which lines change. Opened from the
 * week's ⋯; the plain Duplicate stays beside it. docs/program-layout.md §5.
 *
 * Inline rather than a dialog, like ConfirmStrip: the keyboard stays on the
 * page. Enter in any field duplicates, Escape closes.
 */
export function BumpWeek({
  tree,
  block,
  week,
  anchor,
  names,
  busy,
  onCancel,
  onDuplicate,
}: {
  tree: ProgramTree;
  block: BlockTree;
  week: WeekTree;
  anchor: string | null;
  names: ReadonlyMap<string, string>;
  busy: boolean;
  onCancel: () => void;
  onDuplicate: (bump: Bump) => void;
}) {
  const [fields, setFields] = useState({ kg: "", percent: "", rpe: "" });
  const parsed = parseBump(fields);
  const plan = parsed.ok ? bumpPlan(week, parsed.value) : [];

  // duplicateWeek appends to the week's own block, so the copy is the week
  // after the block's last; every week after it renumbers by one.
  const lastInBlock = block.weeks.at(-1) ?? week;
  const at = weekIndexOf(tree, lastInBlock.id) + 1;
  const later = tree.blocks.flatMap((b) => b.weeks).length - at;
  const landing = `Lands as Week ${at + 1}${anchor ? `, ${rangeLabel(weekRange(anchor, at))}` : ""}, at the end of ${block.name}${
    later > 0 ? `. The ${later === 1 ? "week" : `${later} weeks`} after it renumber` : ""
  }.`;

  const submit = () => {
    if (parsed.ok && !busy) onDuplicate(parsed.value);
  };
  const field = (key: keyof typeof fields, label: string, placeholder: string) => (
    <label className="flex min-w-0 flex-col gap-1 text-label uppercase text-muted-2">
      {label}
      {/* No inputMode="decimal": iOS's decimal pad has no minus, and a
          deload is a step of -5. */}
      <input
        aria-label={label}
        placeholder={placeholder}
        value={fields[key]}
        autoFocus={key === "percent"}
        onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        className="h-10 w-full rounded-control border border-border bg-surface-2 px-2 text-action text-foreground tabular-nums normal-case focus:border-accent-line focus:outline-none md:h-9 md:w-24 md:text-ui"
      />
    </label>
  );

  return (
    <section aria-label="Duplicate with a bump" className="flex flex-col gap-3 rounded-card border border-border p-3 md:p-4">
      {/* Phone: the three steps share one row, the buttons wrap under them. */}
      <div className="grid grid-cols-3 items-end gap-3 md:flex md:flex-wrap">
        {field("percent", "+ %", "2.5")}
        {field("kg", "+ kg", "5")}
        {field("rpe", "+ RPE", "0.5")}
        <span className="hidden flex-1 md:block" />
        <Button size="sm" disabled={busy || !parsed.ok} onClick={submit} className="col-span-2 max-md:h-10">
          Duplicate with bump
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} className="max-md:h-10">
          Cancel
        </Button>
      </div>
      <p className="m-0 text-ui text-muted" aria-live="polite">
        {landing}
      </p>
      {!parsed.ok ? (
        <p role="alert" className="m-0 text-ui text-danger-line">
          {parsed.reason}
        </p>
      ) : isNoBump(parsed.value) ? (
        <p className="m-0 text-ui text-muted-2">No step yet: the copy is the week as it is.</p>
      ) : plan.length === 0 ? (
        <p className="m-0 text-ui text-muted-2">No line takes that step: freeform words and other kinds stay as written.</p>
      ) : (
        <ul aria-label="Lines that change" className="m-0 flex list-none flex-col gap-0.5 p-0 text-ui tabular-nums">
          {plan.map((change) => (
            <li key={`${change.dayIndex}-${change.lineIndex}`} className="text-muted">
              <span className="text-foreground">{names.get(change.exerciseId) ?? "Exercise"}</span>: {change.from} → {change.to}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
