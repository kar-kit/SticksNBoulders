"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  checkDisplayName,
  nameRejectionMessage,
  needsSex,
  sexLabel,
  SEX_OPTIONS,
  UNIT_OPTIONS,
  unitLabel,
  type Profile,
  type Sex,
  type Units,
} from "@/lib/profile/profile";
import { ensureMyProfile, saveProfile } from "@/lib/profile/profile-store";

/**
 * TRAINING, from the Profile & Settings blueprint.
 *
 * Three fields, and only one of them is interesting. The name is what a coach
 * sees in their rail -- until this ticket nothing ever wrote a profile row, so
 * that rail was blank for everyone. Units are a display preference; everything
 * is stored in kilograms regardless.
 *
 * Sex is the one that matters, because DOTS has two coefficient sets and no
 * sensible default between them. The blueprint calls it required; the column is
 * nullable, so that an account created before this ticket can be given a
 * profile at all rather than refused one. The gap between those two is closed
 * here rather than in the schema: unset is shown as a question, not as a blank.
 *
 * Bodyweight is the blueprint's fourth row and belongs to Order 36.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; profile: Profile }
  | { status: "failed" };

export function TrainingSettings() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState({ status: "loading" });
      try {
        const profile = await ensureMyProfile();
        if (cancelled) return;
        setState(profile ? { status: "ready", profile } : { status: "failed" });
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className="m-0 text-body text-muted" aria-busy>Loading your profile…</p>;
  }

  if (state.status === "failed") {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-ui font-semibold text-muted">Training</h2>
        <p className="m-0 text-body text-muted">
          Couldn&rsquo;t load your profile. Your training is unaffected — try again later.
        </p>
      </section>
    );
  }

  const { profile } = state;

  /** Optimistic: the row is small, and a settings screen that lags feels broken. */
  const apply = async (edit: Partial<Profile>) => {
    const next = { ...profile, ...edit };
    setState({ status: "ready", profile: next });
    setSaving(true);
    try {
      await saveProfile(profile.userId, {
        displayName: edit.displayName,
        sex: edit.sex ?? undefined,
        units: edit.units,
      });
    } catch {
      // Put it back rather than leaving the screen claiming something the
      // server does not hold. A wrong sex here is a wrong DOTS score later.
      setState({ status: "ready", profile });
    } finally {
      setSaving(false);
    }
  };

  const commitName = async () => {
    const checked = checkDisplayName(draftName);
    if (!checked.ok) {
      setNameError(nameRejectionMessage(checked));
      return;
    }
    setNameError(null);
    setEditingName(false);
    await apply({ displayName: checked.name });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-ui font-semibold text-muted">Training</h2>

      <div className="flex flex-col gap-1">
        <span className="text-ui text-muted">Name</span>
        {editingName ? (
          <div className="flex flex-col gap-2">
            <TextField
              value={draftName}
              autoFocus
              maxLength={80}
              invalid={Boolean(nameError)}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitName();
                if (event.key === "Escape") {
                  setEditingName(false);
                  setNameError(null);
                }
              }}
            />
            {nameError ? <p className="m-0 text-ui text-foreground">{nameError}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void commitName()} disabled={saving}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingName(false);
                  setNameError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftName(profile.displayName);
              setEditingName(true);
            }}
            className="flex items-center justify-between rounded-control border border-border px-3 py-2.5 text-left"
          >
            <span className="text-body">{profile.displayName || "Not set"}</span>
            <span className="text-ui text-muted">Edit</span>
          </button>
        )}
        <p className="m-0 text-ui text-muted-2">This is what your coach sees.</p>
      </div>

      <Choice
        label="Sex"
        value={profile.sex}
        options={SEX_OPTIONS}
        render={(option) => sexLabel(option)}
        onChoose={(sex: Sex) => void apply({ sex })}
        disabled={saving}
      />
      {needsSex(profile) ? (
        // Asked rather than assumed. The blueprint wants this at onboarding;
        // until that screen exists this is where it gets asked, and DOTS
        // renders nothing at all until it is answered.
        <p className="m-0 text-ui text-muted">
          Needed for DOTS — the coefficients differ, and there is no sensible default. Your
          bodyweight score stays hidden until you set it.
        </p>
      ) : null}

      <Choice
        label="Units"
        value={profile.units}
        options={UNIT_OPTIONS}
        render={(option) => unitLabel(option)}
        onChoose={(units: Units) => void apply({ units })}
        disabled={saving}
      />
      <p className="m-0 text-ui text-muted-2">
        Display only. Everything is stored in kilograms, so switching never changes a logged
        number.
      </p>
    </section>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  render,
  onChoose,
  disabled,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  render: (option: T) => string;
  onChoose: (option: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui text-muted">{label}</span>
      <div className="flex gap-2" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={value === option}
            onClick={() => onChoose(option)}
            className={cn(
              "h-11 flex-1 rounded-control border px-3 text-body",
              value === option
                ? "border-accent-line bg-accent-fill font-semibold text-on-accent"
                : "border-border text-muted",
            )}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
