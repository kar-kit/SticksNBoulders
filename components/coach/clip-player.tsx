"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The video, and the controls a form review actually needs.
 *
 * The blueprint is blunt about this: slow motion and loop are not luxuries. A
 * coach watches a squat five times before saying anything, so loop is on by
 * default and the speeds start below real time rather than above it.
 *
 * Everything is reachable from the keyboard because the screen is measured by
 * how fast it clears. A coach working through twenty clips should barely touch
 * the mouse -- space to play, arrows to step a frame, and the clearing key
 * handled by the queue above.
 */

/** No real-time option. A clip playing at 1x is what the athlete already saw. */
export const SPEEDS = [0.25, 0.5, 1] as const;

/**
 * One frame at 30fps. Browsers expose no frame boundary on a `<video>`, so a
 * step is a nudge of `currentTime` -- close enough to land on the next frame
 * of phone footage, which is what this is stepping through.
 */
const FRAME_SECONDS = 1 / 30;

export interface ClipPlayerProps {
  /** Null while the URL is being minted, or when there is nothing to show. */
  src: string | null;
  /** Changes when the clip does, so playback restarts rather than continuing. */
  clipId: string;
}

export function ClipPlayer({ src, clipId }: ClipPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState<number>(0.5);
  const [loop, setLoop] = useState(true);
  // Which clip failed, rather than whether one did. A boolean would need an
  // effect to clear it when the clip changes, and an effect that resets state
  // on every prop change is a render the screen does not need -- the id it
  // failed on answers the question directly.
  const [failedClip, setFailedClip] = useState<string | null>(null);
  const failed = failedClip === clipId;

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, src]);

  const step = useCallback((direction: 1 | -1) => {
    const element = video.current;
    if (!element) return;
    element.pause();
    element.currentTime = Math.max(0, element.currentTime + direction * FRAME_SECONDS);
  }, []);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never while the coach is writing. Order 33 puts a comment box on this
      // screen, and a space that pauses the video mid-word would make it
      // unusable.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      if (event.key === " ") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, toggle]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[3/4] w-full max-w-[420px] overflow-hidden rounded-control bg-surface-2">
        {src && !failed ? (
          <video
            // Keyed on the clip so switching swaps the element rather than
            // mutating one that is mid-decode, which strands the old frame.
            key={clipId}
            ref={video}
            src={src}
            className="size-full object-contain"
            controls
            loop={loop}
            playsInline
            preload="metadata"
            onError={() => setFailedClip(clipId)}
          />
        ) : (
          <div className="flex size-full items-center justify-center p-6 text-center text-ui text-muted">
            {failed
              ? "This clip would not play. It may still be uploading from their phone, or the athlete may have withdrawn access."
              : "Loading the clip…"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpeed(option)}
              aria-pressed={speed === option}
              className={cn(
                "h-9 rounded-chip px-3 text-ui font-medium",
                speed === option
                  ? "bg-accent-fill text-on-accent"
                  : "border border-border text-muted hover:text-foreground",
              )}
            >
              {option}x
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLoop((on) => !on)}
          aria-pressed={loop}
          className={cn(
            "h-9 rounded-chip px-3 text-ui font-medium",
            loop ? "bg-accent-fill text-on-accent" : "border border-border text-muted hover:text-foreground",
          )}
        >
          Loop
        </button>

        <div className="flex items-center gap-1" role="group" aria-label="Frame step">
          <button
            type="button"
            onClick={() => step(-1)}
            className="h-9 rounded-chip border border-border px-3 text-ui font-medium text-muted hover:text-foreground"
          >
            ‹ Frame
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            className="h-9 rounded-chip border border-border px-3 text-ui font-medium text-muted hover:text-foreground"
          >
            Frame ›
          </button>
        </div>
      </div>

      <p className="m-0 text-ui text-muted-2">
        Space plays, arrows step a frame. Enter skips; ⌘/Ctrl + Enter comments and moves on.
      </p>
    </div>
  );
}
