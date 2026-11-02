"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ReactIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { Comment } from "@/lib/review/comments";
import {
  canReactTo,
  chipLabel,
  myReaction,
  reactionChips,
  REACTION_EMOJIS,
  REACTION_NAMES,
  type ReactionEmoji,
} from "@/lib/review/reactions";
import type { ReactionControls } from "@/lib/review/use-reactions";
import { haptic } from "@/lib/ui/haptics";

/**
 * A message in a thread, with its reactions under it (F25).
 *
 * Wraps whatever bubble the screen already draws -- the Feedback card's and
 * `CommentThread`'s look different and stay that way -- and adds two things
 * beneath it: the chips people have left, the viewer's own highlighted, and a
 * small react button that opens the six. On a touch screen a long press on the
 * message opens them too; that is a shortcut for thumbs, never the only way
 * in, so the button stays for everyone else (a mouse, a keyboard, a screen
 * reader, an iPhone that thinks a long press means "select this text").
 *
 * Without `controls` it is just the bubble, so a screen that has not wired
 * reactions renders exactly as it did before F25.
 *
 * Quiet by design: nothing here moves a badge, a "New" mark or a watermark.
 */
export function Reactable({
  comment,
  controls,
  authorName,
  children,
}: {
  comment: Comment;
  controls?: ReactionControls;
  /** Who wrote the message, for the react button's name: "React to Ruairi's message". */
  authorName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const allowed = Boolean(controls?.canReact && controls && canReactTo(comment, controls.viewerId));
  const press = useLongPress(() => {
    if (!allowed) return;
    setOpen(true);
    haptic("light");
  });

  if (!controls) return <>{children}</>;

  const onComment = controls.byComment.get(comment.id) ?? [];
  const chips = reactionChips(onComment, controls.viewerId);
  const mine = myReaction(onComment, comment.id, controls.viewerId)?.emoji ?? null;
  const busy = controls.pending.has(comment.id);
  const notice = controls.notice?.commentId === comment.id ? controls.notice.text : null;
  const react = (emoji: ReactionEmoji) => {
    setOpen(false);
    controls.onReact(comment, emoji);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div {...(allowed ? press : {})}>{children}</div>
      {chips.length > 0 || allowed || notice ? (
        <ReactionRow
          chips={chips}
          mine={mine}
          allowed={allowed}
          busy={busy}
          open={open}
          setOpen={setOpen}
          onPick={react}
          authorName={authorName}
          notice={notice}
        />
      ) : null}
    </div>
  );
}

/**
 * Keys a reaction button owns, kept from the window.
 *
 * The Review Queue clears the clip on a bare Enter and ClipPlayer plays on
 * Space and steps on the arrows, both listening on the window and both
 * ignoring only text fields and links. Without this, choosing 👍 with the
 * keyboard would also clear the clip the coach is looking at. React's
 * stopPropagation stops the native event at the root, before the window.
 */
const OWNED_KEYS = new Set(["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"]);

function ReactionRow({
  chips,
  mine,
  allowed,
  busy,
  open,
  setOpen,
  onPick,
  authorName,
  notice,
}: {
  chips: ReturnType<typeof reactionChips>;
  mine: ReactionEmoji | null;
  allowed: boolean;
  busy: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  onPick: (emoji: ReactionEmoji) => void;
  authorName: string;
  notice: string | null;
}) {
  const pickerId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);

  // On open, focus lands on the viewer's current reaction, or the first: the
  // one they are most likely to change, or the start of the row.
  useEffect(() => {
    if (!open) return;
    const buttons = [...(picker.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    (buttons.find((b) => b.getAttribute("aria-pressed") === "true") ?? buttons[0])?.focus();
  }, [open]);

  // A tap anywhere else closes it, as the ⋯ menu does.
  useEffect(() => {
    if (!open) return;
    const away = (event: globalThis.PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, setOpen]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!OWNED_KEYS.has(event.key) || !(event.target instanceof HTMLButtonElement)) return;
    // Escape is ours only while the six are open. Otherwise it belongs to
    // whatever holds the thread -- the Athlete View's clip dialog closes on it.
    if (event.key === "Escape" && !open) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    // Left and right walk the six, so the picker is one tab stop.
    if (open && (event.key === "ArrowLeft" || event.key === "ArrowRight") && picker.current?.contains(event.target)) {
      event.preventDefault();
      const buttons = [...picker.current.querySelectorAll<HTMLButtonElement>("button")];
      const at = buttons.indexOf(event.target);
      const next = (at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  };

  return (
    <div ref={wrapper} className="flex flex-col gap-1.5" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => {
          const label = chipLabel(chip, REACTION_NAMES[chip.emoji]);
          const look = cn(
            "inline-flex h-8 items-center gap-1 rounded-chip border px-2.5 text-ui tabular-nums",
            chip.mine ? "border-accent-line bg-surface-2 font-semibold text-foreground" : "border-border text-muted",
          );
          // Tapping a chip is tapping that emoji: your own takes it back,
          // another replaces yours. Read-only where the viewer cannot react.
          return allowed ? (
            <button
              key={chip.emoji}
              type="button"
              aria-pressed={chip.mine}
              aria-label={label}
              disabled={busy}
              onClick={() => onPick(chip.emoji)}
              className={cn(look, "transition-control press focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line")}
            >
              <span aria-hidden>{chip.emoji}</span>
              {chip.count > 1 ? <span aria-hidden>{chip.count}</span> : null}
            </button>
          ) : (
            <span key={chip.emoji} role="img" aria-label={label} className={look}>
              <span aria-hidden>{chip.emoji}</span>
              {chip.count > 1 ? <span aria-hidden>{chip.count}</span> : null}
            </span>
          );
        })}
        {allowed ? (
          <button
            ref={trigger}
            type="button"
            aria-label={mine ? `Change your reaction to ${authorName}'s message` : `React to ${authorName}'s message`}
            aria-expanded={open}
            aria-controls={open ? pickerId : undefined}
            disabled={busy}
            onClick={() => setOpen(!open)}
            className={cn(
              // 40px on a phone, where a thumb is aiming at it mid-set; 32px
              // where a pointer is.
              "inline-flex size-10 items-center justify-center rounded-chip text-muted-2 md:size-8",
              "transition-control press hover:text-foreground focus-visible:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
              open && "bg-surface-2 text-foreground",
            )}
          >
            <ReactIcon width={18} height={18} />
          </button>
        ) : null}
      </div>

      {open && allowed ? (
        <div
          ref={picker}
          id={pickerId}
          role="group"
          aria-label="Reactions"
          className="flex w-fit items-center gap-0.5 rounded-chip border border-border bg-surface p-1 motion-safe:animate-fade-in"
        >
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-pressed={mine === emoji}
              aria-label={mine === emoji ? `Remove ${REACTION_NAMES[emoji]}` : `React ${REACTION_NAMES[emoji]}`}
              title={REACTION_NAMES[emoji]}
              disabled={busy}
              onClick={() => onPick(emoji)}
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-chip text-[22px] md:size-9 md:text-[18px]",
                "transition-control press focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                mine === emoji ? "bg-surface-2 ring-1 ring-accent-line" : "hover:bg-surface-2",
              )}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="m-0 text-caption text-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/** How long a press has to be held to count. Long enough not to fire on a scroll. */
const LONG_PRESS_MS = 450;
/** A finger that moves this far is scrolling, not pressing. */
const SLOP_PX = 10;

/**
 * A long press on a touch screen, and nothing else.
 *
 * Touch only: a mouse has the button, and a long mouse-down is how people
 * select text to copy a coach's words. On a phone the press also tends to
 * start a text selection, so the selection is cleared when it fires, and the
 * context menu that follows it on Android is suppressed for that one press.
 */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };

  // A press still held when the message unmounts must not fire on nothing.
  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      cancel();
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        window.getSelection?.()?.removeAllRanges();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const from = origin.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: { preventDefault: () => void }) => {
      if (fired.current) event.preventDefault();
    },
  };
}
