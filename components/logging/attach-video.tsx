"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { attachClipToSet, type UploadResult } from "@/lib/video/upload";
import type { VideoAsk } from "@/lib/logging/video-prompt";

/**
 * The camera, one per exercise.
 *
 * The Set Row spec is explicit that no row carries a camera: it sits beside
 * the exercise's other actions and attaches to the most recently logged set of
 * that exercise. A per-row camera bought nothing and cost the confirm target
 * its column, and confirm is what an athlete hits 20 to 40 times a session.
 *
 * The set is already logged before this can be pressed, so nothing here blocks
 * logging. Upload progress is a thin line, never a spinner -- "the set is
 * already logged; the upload is incidental".
 */

type State =
  | { status: "idle" }
  | { status: "uploading"; percent: number }
  | { status: "done" }
  /** Did not finish, but kept on the phone and still on its way. */
  | { status: "pending"; message: string }
  | { status: "failed"; message: string };

export interface AttachVideoProps {
  /** The set the clip lands on -- the most recent of this exercise. */
  setId: string;
  athleteId: string;
  /** Attaching again replaces what is there. */
  hasVideo?: boolean;
  /**
   * The coach asked for a clip of this exercise (Order 30). "emphasise" makes
   * the button stand out; "prompt" adds one line saying so. Neither blocks
   * anything, and "Not now" is not recorded -- it only puts the line away.
   */
  ask?: VideoAsk;
  /**
   * A clip is on its way (queued counts, as it does everywhere else). Given
   * the result, so a caller replacing a clip knows whether the new one's
   * attach is already queued (`ok`) or still waiting on the upload.
   */
  onAttached?: (result: UploadResult) => void;
}

export function AttachVideo({ setId, athleteId, hasVideo = false, ask = "none", onAttached }: AttachVideoProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [putAway, setPutAway] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setState({ status: "uploading", percent: 0 });

    const result = await attachClipToSet(setId, athleteId, file, {
      onProgress: (percent) => setState({ status: "uploading", percent }),
    });

    // The message comes from the check that refused it -- "that clip is 48MB,
    // film a shorter one" is actionable on a gym floor; "upload failed" is not.
    // A pending clip is kept on the phone and goes by itself, so it is on its
    // way like a finished one and not a failure to act on.
    const pending = !result.ok && result.reason === "pending";
    setState(
      result.ok
        ? { status: "done" }
        : { status: pending ? "pending" : "failed", message: result.message },
    );
    if (result.ok || pending) onAttached?.(result);
    if (input.current) input.current.value = "";
  };

  const label =
    state.status === "pending"
      ? "Video pending"
      : state.status === "done" || hasVideo
        ? "Replace video"
        : "Add video";

  const prompting = ask === "prompt" && !putAway && state.status === "idle";

  return (
    <div className="flex flex-col items-end gap-1">
      {prompting ? (
        <p role="status" className="m-0 flex items-center gap-2 text-right text-caption text-muted">
          Your coach asked for a clip of this one.
          <button
            type="button"
            onClick={() => setPutAway(true)}
            className="min-h-11 whitespace-nowrap px-2 text-caption text-muted-2 underline"
          >
            Not now
          </button>
        </p>
      ) : null}
      <input
        ref={input}
        type="file"
        // No capture attribute: it forces the camera. Without it the phone
        // offers both, so a set filmed on the camera app can be picked from
        // the library afterwards.
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <Button
        variant={prompting ? "primary" : ask === "emphasise" ? "secondary" : "ghost"}
        size="sm"
        className={ask === "emphasise" ? "border-accent-line text-foreground" : undefined}
        data-video-ask={ask === "none" ? undefined : ask}
        disabled={state.status === "uploading"}
        onClick={() => input.current?.click()}
      >
        {state.status === "uploading" ? `Uploading ${state.percent}%` : label}
      </Button>

      {state.status === "uploading" ? (
        <div
          role="progressbar"
          aria-valuenow={state.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Uploading video"
          className="h-0.5 w-24 overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full bg-foreground transition-[width] duration-200"
            style={{ width: `${state.percent}%` }}
          />
        </div>
      ) : null}

      {state.status === "failed" || state.status === "pending" ? (
        <p
          role="status"
          data-upload={state.status}
          className="m-0 max-w-[220px] text-right text-caption text-muted"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
