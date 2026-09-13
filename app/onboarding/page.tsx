"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES, FUNCTIONS } from "@/lib/constants";
import { callFunction } from "@/lib/call-function";
import type { Sex, UnitPreference } from "@/lib/types";
import PageSpinner from "@/components/PageSpinner";

export default function OnboardingPage() {
  const { user, refreshProfile } = useAuth();
  const router = useRouter();

  const [sex, setSex] = useState<Sex | null>(null);
  const [unitPreference, setUnitPreference] = useState<UnitPreference>("kg");
  const [groupCode, setGroupCode] = useState("");
  const [coachCode, setCoachCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <PageSpinner />;

  async function handleSubmit() {
    if (!sex) {
      setError("Pick a sex so DOTS scoring can be computed correctly.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await tablesDB.createRow(DATABASE_ID, TABLES.profiles, user!.$id, { sex, unitPreference });

      if (groupCode.trim()) {
        await callFunction(FUNCTIONS.teamInviteRedeem, { code: groupCode.trim() });
      }
      if (coachCode.trim()) {
        await callFunction(FUNCTIONS.coachInviteRedeem, { code: coachCode.trim() });
      }

      await refreshProfile();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-1 flex-col gap-8 px-6 pb-safe pt-safe-10">
      <div>
        <h1 className="text-xl font-semibold">Set up your profile</h1>
        <p className="mt-1 text-sm text-muted">
          This is used for DOTS scoring and your unit display. You can join a group or a coach
          later from Profile if you skip it now.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <span className="text-sm font-medium text-muted">Sex</span>
        <div className="flex gap-3">
          {(["male", "female"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setSex(option)}
              className={`flex-1 rounded-xl border py-3 text-sm capitalize transition-colors ${
                sex === option
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <span className="text-sm font-medium text-muted">Units</span>
        <div className="flex gap-3">
          {(["kg", "lb"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setUnitPreference(option)}
              className={`flex-1 rounded-xl border py-3 text-sm uppercase transition-colors ${
                unitPreference === option
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <span className="text-sm font-medium text-muted">Group invite code (optional)</span>
        <input
          value={groupCode}
          onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
          placeholder="e.g. 7K3PQMXR"
          className="h-12 rounded-xl border border-border bg-surface px-4 text-sm tracking-widest uppercase outline-none focus:border-accent"
        />
      </section>

      <section className="flex flex-col gap-3">
        <span className="text-sm font-medium text-muted">Coach invite code (optional)</span>
        <input
          value={coachCode}
          onChange={(e) => setCoachCode(e.target.value.toUpperCase())}
          placeholder="e.g. 9F2WZQRT"
          className="h-12 rounded-xl border border-border bg-surface px-4 text-sm tracking-widest uppercase outline-none focus:border-accent"
        />
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-auto h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {submitting ? "Setting up…" : "Continue"}
      </button>
    </div>
  );
}
