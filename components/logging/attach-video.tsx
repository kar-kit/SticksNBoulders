"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { attachClipToSet } from "@/lib/video/upload";

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
  | { status: "failed"; message: string };

export interface AttachVideoProps {
  /** The set the clip lands on -- the most recent of this exercise. */
  setId: string;
  athleteId: string;
  /** Attaching again replaces what is there. */
  hasVideo?: boolean;
}

export function AttachVideo({ setId, athleteId, hasVideo = false }: AttachVideoProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setState({ status: "uploading", percent: 0 });

    const result = await attachClipToSet(setId, athleteId, file, {
      onProgress: (percent) => setState({ status: "uploading", percent }),
    });

    // The message comes from the check that refused it -- "that clip is 48MB,
    // film a shorter one" is actionable on a gym floor; "upload failed" is not.
    setState(result.ok ? { status: "done" } : { status: "failed", message: result.message });
    if (input.current) input.current.value = "";
  };

  const label = state.status === "done" || hasVideo ? "Replace video" : "Add video";

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        // capture asks the phone for the camera rather than the photo library,
        // which is where the clip is about to come from.
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
        capture="environment"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <Button
        variant="ghost"
        size="sm"
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

      {state.status === "failed" ? (
        <p role="status" className="m-0 max-w-[220px] text-right text-caption text-muted">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
