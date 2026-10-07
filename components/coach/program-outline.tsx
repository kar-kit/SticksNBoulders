"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { ConfirmStrip, InlineText } from "@/components/coach/program-editor-parts";
import { cn } from "@/lib/cn";
import { blockRange, rangeLabel, weekRange } from "@/lib/programming/calendar";
import { weekState, type WeekState } from "@/lib/programming/editor";
import type { BlockTree, ProgramTree } from "@/lib/programming/program";

/**
 * The program's outline: blocks down the left of the editor, each with its
 * dates and its weeks, each week with where it stands. Replaces the two rows
 * of block and week tabs.
 *
 * A block is a phase. Its name is the phase (Accumulation, Intensity, Peak,
 * Taper, Deload are one click away in its ⋯), so there is no phase column to
 * add -- Calgary Barbell's named phases with week ranges, over the same rows.
 *
 * "+ Week" repeats the block's last week (RTS: write a week, repeat it,
 * adjust); "+ Block" starts the next phase from the last week before it. Both
 * are copies the coach then edits, never links: changing week 3 later does not
 * reach week 4.
 *
 * Keyboard: Tab reaches the selected week, Up and Down walk every week in the
 * program, Enter shows it.
 */

/** Quick names for a block. [Inference] The four Calgary Barbell phases, plus deload. */
export const PHASES = ["Accumulation", "Intensity", "Peak", "Taper", "Deload"] as const;

const STATE_LABEL: Record<WeekState, string> = { draft: "Draft", live: "Live", logged: "Logged" };

export interface ProgramOutlineProps {
  tree: ProgramTree;
  selectedWeekId: string | null;
  onSelect: (weekId: string) => void;
  editable: boolean;
  busy: boolean;
  anchor: string | null;
  /** Null when the sessions could not be read: no week is marked logged by guess. */
  logged: ReadonlySet<string> | null;
  weekName: (weekId: string) => string;
  onAddWeek: (block: BlockTree) => void;
  onAddBlock: () => void;
  onRenameBlock: (block: BlockTree, name: string) => void;
  onRemoveBlock: (block: BlockTree) => void;
}

export function ProgramOutline({
  tree,
  selectedWeekId,
  onSelect,
  editable,
  busy,
  anchor,
  logged,
  weekName,
  onAddWeek,
  onAddBlock,
  onRenameBlock,
  onRemoveBlock,
}: ProgramOutlineProps) {
  const [removing, setRemoving] = useState<string | null>(null);
  const allWeeks = tree.blocks.flatMap((b) => b.weeks);

  const walk = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-outline-week]")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    buttons[Math.min(buttons.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return (
    <nav
      aria-label="Program outline"
      onKeyDown={walk}
      className="flex w-56 flex-none flex-col gap-4 self-stretch border-r border-border py-5 pr-3 pl-4"
    >
      {tree.blocks.length === 0 ? <p className="m-0 text-ui text-muted">No blocks yet.</p> : null}
      {tree.blocks.map((block) => {
        const range = blockRange(tree, block.id);
        return (
          <section key={block.id} aria-label={block.name} className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              {editable ? (
                <InlineText
                  label={`${block.name} name`}
                  value={block.name}
                  className="h-8 flex-1 text-ui font-semibold"
                  onCommit={(name) => (name ? onRenameBlock(block, name) : null)}
                />
              ) : (
                <span className="flex-1 truncate px-1 text-ui font-semibold">{block.name}</span>
              )}
              {editable ? (
                <Menu
                  label={`${block.name} actions`}
                  disabled={busy}
                  items={[
                    ...PHASES.filter((phase) => phase !== block.name).map((phase) => ({
                      label: `Call it ${phase}`,
                      onSelect: () => onRenameBlock(block, phase),
                    })),
                    { label: `Remove ${block.name}`, tone: "danger" as const, onSelect: () => setRemoving(block.id) },
                  ]}
                />
              ) : null}
            </div>
            <p className="m-0 px-1 font-mono text-label text-muted-2 uppercase">
              {range ? rangeLabel(range) : `${block.weeks.length} ${block.weeks.length === 1 ? "week" : "weeks"}`}
            </p>
            {removing === block.id ? (
              <ConfirmStrip
                label={`Remove ${block.name}`}
                disabled={busy}
                className="px-1"
                onCancel={() => setRemoving(null)}
                onConfirm={() => onRemoveBlock(block)}
              />
            ) : null}
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {block.weeks.map((week) => {
                const at = allWeeks.findIndex((w) => w.id === week.id);
                const state = weekState(tree, week, logged);
                const selected = week.id === selectedWeekId;
                const name = weekName(week.id);
                return (
                  <li key={week.id}>
                    <button
                      type="button"
                      data-outline-week
                      aria-current={selected ? "true" : undefined}
                      aria-label={`${name}, ${STATE_LABEL[state].toLowerCase()}`}
                      tabIndex={selected || (!selectedWeekId && at === 0) ? 0 : -1}
                      onClick={() => onSelect(week.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-chip px-2 py-1.5 text-left",
                        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-line",
                        selected
                          ? "bg-surface-2 shadow-[inset_2px_0_0_var(--accent-fill)]"
                          : "hover:bg-surface-2/60",
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className={cn("truncate text-ui", selected ? "font-semibold text-foreground" : "text-foreground")}>
                          {name}
                        </span>
                        {anchor ? (
                          <span className="text-caption text-muted-2">{rangeLabel(weekRange(anchor, at))}</span>
                        ) : null}
                      </span>
                      <StateMark state={state} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {editable ? (
              <button
                type="button"
                disabled={busy}
                aria-label={`+ Week in ${block.name}`}
                title={
                  block.weeks.length > 0
                    ? `Copies ${weekName(block.weeks.at(-1)!.id).toLowerCase()}; edit it from there`
                    : "Starts an empty week"
                }
                onClick={() => onAddWeek(block)}
                className="h-8 rounded-chip px-2 text-left text-ui text-muted hover:text-foreground disabled:text-muted-2 focus-visible:outline-2 focus-visible:outline-accent-line"
              >
                + Week
              </button>
            ) : null}
          </section>
        );
      })}
      {editable ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onAddBlock} className="self-start">
          + Block
        </Button>
      ) : null}
    </nav>
  );
}

/** Draft is hollow, live is filled, logged is ticked. The word is there too: colour never carries it alone. */
function StateMark({ state }: { state: WeekState }) {
  return (
    <span aria-hidden="true" data-state={state} className="flex flex-none items-center gap-1 text-caption">
      {state === "logged" ? (
        <span className="text-success">✓</span>
      ) : (
        <span
          className={cn(
            "block size-2 rounded-full",
            state === "live" ? "bg-accent-fill" : "border border-muted-2",
          )}
        />
      )}
      <span className={state === "draft" ? "text-muted-2" : state === "live" ? "text-foreground" : "text-success"}>
        {STATE_LABEL[state]}
      </span>
    </span>
  );
}
