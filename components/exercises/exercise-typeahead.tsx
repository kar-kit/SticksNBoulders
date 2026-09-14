"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { TextField } from "@/components/ui/input";
import {
  defaultExercises,
  isNewExercise,
  rankExercises,
  tierFor,
  MAX_RESULTS,
  type Exercise,
} from "@/lib/exercises/match";

/**
 * Choosing an exercise by typing its name.
 *
 * Ruairi's complaint number two, directly: RTS made him hunt through a tree for
 * a lift he could have spelled. So there is no tree, no dropdown of the whole
 * library, and no step between typing and having the thing you typed -- a name
 * the library does not hold is created on the spot.
 *
 * It ships to both surfaces, which is why it is a full combobox rather than a
 * list of tappable rows. The athlete meets it at 390pt with a thumb, so every
 * option is a 52px target; Ruairi meets it in the Program Editor at 1440 with
 * his hands on the keyboard, so arrows move, Enter selects and Escape dismisses
 * without anything being touched. Building one of those and retrofitting the
 * other at Order 19 would mean rewriting it.
 */

export interface ExerciseTypeaheadProps {
  exercises: readonly Exercise[];
  onSelect: (exercise: Exercise) => void;
  /**
   * Called with a name the library does not hold. Omit to forbid creation --
   * the coach's Program Editor may want that; the athlete's logger never does.
   */
  onCreate?: (name: string) => void;
  placeholder?: string;
  /** `lg` is the 56px field. Default `md` matches every other field at 48px. */
  size?: "md" | "lg";
  label?: string;
  autoFocus?: boolean;
  /** Shown under the field while the library is still loading or failed. */
  hint?: string | null;
  /**
   * Empties the field after a choice instead of leaving the name in it.
   *
   * Right for a field whose job is "add another" -- the logger, where the next
   * thing an athlete does is add a second exercise. Wrong for a picker that
   * holds a value, which is what the Program Editor needs.
   */
  clearOnSelect?: boolean;
  limit?: number;
}

type Option =
  | { kind: "exercise"; exercise: Exercise }
  | { kind: "create"; name: string };

export function ExerciseTypeahead({
  exercises,
  onSelect,
  onCreate,
  placeholder = "Type an exercise",
  size = "md",
  label = "Exercise",
  autoFocus = false,
  hint = null,
  limit = MAX_RESULTS,
  clearOnSelect = false,
}: ExerciseTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const options = useMemo<Option[]>(() => {
    const trimmed = query.trim();
    // An empty field is where the athlete starts. Showing nothing there reads
    // as a broken screen, so it offers their own exercises first.
    const ranked = trimmed ? rankExercises(trimmed, exercises, limit) : [];
    const matches = trimmed ? ranked.map((m) => m.exercise) : defaultExercises(exercises, limit);

    const list: Option[] = matches.map((exercise) => ({ kind: "exercise", exercise }));

    // "rdl" is not an exercise anybody wants in their library, it is how
    // Romanian Deadlift gets typed. Offering to create one is offering a junk
    // row a single mis-tap away, so a query that matched something by its
    // initials never offers creation.
    //
    // A typo does, though. "bech press" might be a real lift this athlete
    // does, the right match sits directly above it, and being unable to add
    // something is the failure that sends a coach back to a spreadsheet.
    // Checked against the whole library, not against `ranked` -- that list is
    // capped for display, and a suppression rule that depended on the cap
    // would quietly stop working as the library grew.
    const abbreviation = Boolean(trimmed) && exercises.some((e) => tierFor(trimmed, e) === "acronym");

    if (onCreate && trimmed && !abbreviation && isNewExercise(trimmed, exercises)) {
      // Last, never first. Selecting an existing lift is the common case, and
      // a create option under the thumb would split a lift's history in two.
      list.push({ kind: "create", name: trimmed });
    }
    return list;
  }, [query, exercises, limit, onCreate]);

  const clamped = Math.min(activeIndex, Math.max(0, options.length - 1));

  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (option.kind === "exercise") {
      setQuery(clearOnSelect ? "" : option.exercise.name);
      onSelect(option.exercise);
    } else {
      setQuery(clearOnSelect ? "" : option.name);
      onCreate?.(option.name);
    }
    setOpen(false);
    setActiveIndex(0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps, so holding one arrow key always reaches everything.
      setActiveIndex((index) => {
        const next = Math.min(index, options.length - 1) + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      if (!open || options.length === 0) return;
      event.preventDefault();
      choose(options[clamped]);
      return;
    }
    if (event.key === "Escape") {
      // Dismisses the list and keeps what was typed. Nothing is chosen by
      // backing out of a list.
      setOpen(false);
      setActiveIndex(0);
    }
  };

  const showList = open && options.length > 0;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <TextField
        size={size}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        aria-activedescendant={showList ? `${baseId}-option-${clamped}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={query}
        active={showList}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {hint ? <p className="m-0 text-label text-muted-2">{hint}</p> : null}

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} results`}
          className="m-0 flex list-none flex-col overflow-hidden rounded-control border border-border bg-surface p-0"
        >
          {options.map((option, index) => {
            const active = index === clamped;
            const key = option.kind === "create" ? `create:${option.name}` : option.exercise.id;
            return (
              <li key={key} className="contents">
                <button
                  type="button"
                  id={`${baseId}-option-${index}`}
                  role="option"
                  aria-selected={active}
                  aria-label={
                    option.kind === "create"
                      ? `Add custom exercise: ${option.name}`
                      : option.exercise.name
                  }
                  // Selection must survive the blur that a tap would otherwise
                  // fire first, closing the list before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex min-h-[52px] w-full items-center justify-between gap-3 px-3 text-left",
                    "border-b border-border last:border-b-0",
                    // The raised surface marks the active option. Accent is a
                    // line token here, never a fill behind a 13px name: it is
                    // 4.22:1 and the palette says so at the token.
                    active ? "bg-surface-2" : "bg-transparent",
                    option.kind === "create" && "border-l-2 border-l-accent-line",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-line",
                  )}
                >
                  {option.kind === "exercise" ? (
                    <>
                      <span className="text-body text-foreground">{option.exercise.name}</span>
                      {!option.exercise.isGlobal ? (
                        <span className="font-mono text-label uppercase text-muted-2">yours</span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {/*
                        The heading is generic rather than "Add bench", which
                        reads as a command built from half a typed word --
                        Joey's call, 14 Sep. The name still shows underneath,
                        because this row is one tap from putting a row in the
                        library forever and nothing should get there unseen.
                      */}
                      <span className="flex flex-col gap-0.5 py-2">
                        <span className="text-body text-foreground">Add custom exercise</span>
                        <span className="text-caption text-muted">&ldquo;{option.name}&rdquo;</span>
                      </span>
                      <span className="font-mono text-label uppercase text-muted-2">new</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
