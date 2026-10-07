"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/profile/user-avatar";
import { browserPipeline, prepareAvatar, type AvatarType } from "@/lib/profile/avatar";
import { useAvatarFile } from "@/lib/profile/avatar-cache";
import { AvatarUnavailable, removeMyAvatar, replaceMyAvatar } from "@/lib/profile/avatar-store";

/**
 * The Photo row: tap the picture, choose or take one, see it cropped, save.
 *
 * The preview is the prepared file itself -- already square, upright and
 * 512px -- so what someone approves is exactly what their coach will see, not
 * the original with a CSS crop laid over it.
 *
 * Needs a connection and says so in a sentence. Nothing else on the screen
 * waits on it.
 */

type State =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "preview"; blob: Blob; type: AvatarType; url: string }
  | { status: "saving" }
  | { status: "removing" };

export interface PhotoSettingsProps {
  userId: string;
  name: string;
  /** Called after a picture is saved. The welcome screen moves on from here. */
  onSaved?: () => void;
}

const failureMessage = (error: unknown) =>
  error instanceof AvatarUnavailable ? error.message : "Couldn’t save your photo. Check your connection and try again.";

export function PhotoSettings({ userId, name, onSaved }: PhotoSettingsProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const hasPhoto = useAvatarFile(userId) !== null;

  // A preview's object URL is only needed while it is on screen.
  const previewUrl = state.status === "preview" ? state.url : null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const pick = () => {
    setError(null);
    input.current?.click();
  };

  const chosen = async (file: File | undefined) => {
    if (!file) return;
    setState({ status: "preparing" });
    const prepared = await prepareAvatar(file, browserPipeline);
    if (!prepared.ok) {
      setError(prepared.message);
      setState({ status: "idle" });
      return;
    }
    setState({ status: "preview", blob: prepared.blob, type: prepared.type, url: URL.createObjectURL(prepared.blob) });
  };

  const save = async (blob: Blob, type: AvatarType) => {
    setState({ status: "saving" });
    try {
      await replaceMyAvatar(blob, type);
      setState({ status: "idle" });
      onSaved?.();
    } catch (failure) {
      setError(failureMessage(failure));
      setState({ status: "idle" });
    }
  };

  const remove = async () => {
    setError(null);
    setState({ status: "removing" });
    try {
      await removeMyAvatar();
    } catch (failure) {
      setError(failureMessage(failure));
    }
    setState({ status: "idle" });
  };

  const busy = state.status === "preparing" || state.status === "saving" || state.status === "removing";

  return (
    <section aria-label="Photo" className="flex items-center gap-4">
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        aria-label={hasPhoto ? "Change photo" : "Add a photo"}
        className="rounded-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
      >
        {state.status === "preview" ? (
          <Avatar name={name} src={state.url} size={64} />
        ) : (
          <UserAvatar userId={userId} name={name} size={64} />
        )}
      </button>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-body">Photo</span>
        {state.status === "preview" ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save(state.blob, state.type)}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setState({ status: "idle" })}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={pick}>
              {state.status === "preparing"
                ? "Preparing…"
                : state.status === "saving"
                  ? "Saving…"
                  : hasPhoto
                    ? "Change"
                    : "Add photo"}
            </Button>
            {hasPhoto ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
                {state.status === "removing" ? "Removing…" : "Remove"}
              </Button>
            ) : null}
          </div>
        )}
        {error ? (
          <p role="alert" className="m-0 text-ui text-muted">
            {error}
          </p>
        ) : null}
      </div>

      <input
        ref={input}
        type="file"
        // image/* rather than a list: on a phone it offers the camera and the
        // library both, and iOS converts HEIC to JPEG on the way out.
        accept="image/*"
        hidden
        onChange={(event) => {
          void chosen(event.target.files?.[0]);
          // So choosing the same file again still fires a change.
          event.target.value = "";
        }}
      />
    </section>
  );
}
