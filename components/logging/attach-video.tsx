"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { usePresence } from "@/components/ui/motion";
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
 *
 * The coach's ask (Order 30) is said once, as a small popup right after the
 * athlete logs a set the coach wanted filmed (F18, `nudge`). The screen decides
 * when; this owns the popup because it owns the file input and the upload, so
 * "Attach now" is the same pick, the same upload and the same poster grab as
 * the button.
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
   * The coach asked for a clip of this exercise (Order 30). Either asking
   * value makes the button stand out ("prompt", every flagged set logged, a
   * little more). Neither blocks anything; the words are the popup's, below.
   */
  ask?: VideoAsk;
  /**
   * Show the coach's ask as a popup now (F18): the set this camera points at
   * was just logged, the coach wanted it filmed and it has no clip. Ignored
   * while an upload runs. The caller makes sure it is once per exercise.
   */
  nudge?: boolean;
  /** The popup is up. The caller records it, so it is never shown again. */
  onNudgeShown?: () => void;
  /** The popup was answered, either way: Attach now, Later, Escape, the backdrop. */
  onNudgeClose?: () => void;
  /**
   * A clip is on its way (queued counts, as it does everywhere else). Given
   * the result, so a caller replacing a clip knows whether the new one's
   * attach is already queued (`ok`) or still waiting on the upload.
   */
  onAttached?: (result: UploadResult) => void;
  /** True while this button's upload runs, so a caller can hold back actions it would race. */
  onUploadingChange?: (uploading: boolean) => void;
}

export function AttachVideo({
  setId,
  athleteId,
  hasVideo = false,
  ask = "none",
  nudge = false,
  onNudgeShown,
  onNudgeClose,
  onAttached,
  onUploadingChange,
}: AttachVideoProps) {
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const heading = useId();
  const popup = usePresence(nudge && state.status !== "uploading");
  /** How the last popup was answered: Later hands the focus to the camera. */
  const answered = useRef<"attach" | "later">("later");

  const showing = popup.shown && !popup.leaving;
  const onShownRef = useRef(onNudgeShown);
  useEffect(() => {
    onShownRef.current = onNudgeShown;
  });
  useEffect(() => {
    if (showing) onShownRef.current?.();
  }, [showing]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setState({ status: "uploading", percent: 0 });
    onUploadingChange?.(true);

    const result = await attachClipToSet(setId, athleteId, file, {
      onProgress: (percent) => setState({ status: "uploading", percent }),
    }).finally(() => onUploadingChange?.(false));

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

  const asking = ask !== "none";

  const later = () => {
    answered.current = "later";
    onNudgeClose?.();
  };

  /**
   * Straight from the tap, nothing awaited first: iOS Safari only opens the
   * file picker from inside a user gesture. The native dialog is closed
   * before the click, because a modal makes the rest of the page inert and
   * the input lives outside it -- the picker must not depend on whether a
   * browser lets an inert input open one.
   */
  const attachNow = (event: MouseEvent<HTMLButtonElement>) => {
    answered.current = "attach";
    const dialog = event.currentTarget.closest("dialog");
    if (typeof dialog?.close === "function") {
      if (dialog.open) dialog.close();
    } else {
      dialog?.removeAttribute("open");
    }
    input.current?.click();
    onNudgeClose?.();
  };

  const exited = () => {
    popup.exited();
    // The set's Log button, which had the focus when the popup opened, is
    // gone by now -- the row is logged. After Later the focus lands on the
    // camera, the thing the popup was about, rather than on nothing. Not
    // after Attach now: the picker has it.
    if (answered.current !== "later") return;
    // Still on the leaving dialog counts as nowhere: it is about to go.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !active.closest("dialog")) return;
    root.current?.querySelector<HTMLButtonElement>("button[data-camera]")?.focus({ preventScroll: true });
  };

  return (
    <div ref={root} className="flex flex-col items-end gap-1">
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
        variant={asking ? "secondary" : "ghost"}
        size="sm"
        className={asking ? "border-accent-line text-foreground" : undefined}
        data-camera=""
        data-video-ask={asking ? ask : undefined}
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

      {popup.shown ? (
        <Dialog
          labelledBy={heading}
          onClose={later}
          size="sm"
          feel="athlete"
          leaving={popup.leaving}
          onExited={exited}
        >
          <h2 id={heading} className="m-0 text-title font-semibold">
            Your coach asked for a clip of this set
          </h2>
          <p className="mt-2 mb-0 text-body text-muted">
            Your set is logged either way. You can add the clip later from the exercise.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {/* First, so the dialog's own focus lands on it. */}
            <Button variant="primary" size="lg" block onClick={attachNow} data-nudge="attach">
              Attach now
            </Button>
            <Button variant="ghost" size="lg" block onClick={later} data-nudge="later">
              Later
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
