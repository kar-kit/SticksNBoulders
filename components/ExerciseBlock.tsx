"use client";

import { useState } from "react";
import type { UnitPreference, WorkoutSet } from "@/lib/types";
import { displayWeight } from "@/lib/units";

export default function ExerciseBlock({
  liftName,
  sets,
  unitPreference,
  onAddSet,
}: {
  liftName: string;
  sets: WorkoutSet[];
  unitPreference: UnitPreference;
  onAddSet: (weight: number, reps: number, isWarmup: boolean) => Promise<void>;
}) {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [isWarmup, setIsWarmup] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    const weightValue = parseFloat(weight);
    const repsValue = parseInt(reps, 10);
    if (!Number.isFinite(weightValue) || !Number.isFinite(repsValue) || repsValue < 1) return;
    setSaving(true);
    try {
      await onAddSet(weightValue, repsValue, isWarmup);
      setReps("");
      setIsWarmup(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <h2 className="text-sm font-semibold">{liftName}</h2>

      {sets.length > 0 && (
        <div className="flex flex-col gap-1">
          {sets.map((set, i) => (
            <div key={set.$id} className="flex items-center justify-between text-sm">
              <span className={set.isWarmup ? "text-muted" : ""}>
                Set {i + 1}
                {set.isWarmup && " · warm-up"}
              </span>
              <span className="font-medium">
                {displayWeight(set.weightKg, unitPreference)} {unitPreference} × {set.reps}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={`Weight (${unitPreference})`}
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
        />
        <input
          inputMode="numeric"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="Reps"
          className="h-11 w-20 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setIsWarmup((w) => !w)} className="flex items-center gap-2 text-xs text-muted">
          <span
            className={`flex h-4 w-4 items-center justify-center rounded border ${
              isWarmup ? "border-accent bg-accent" : "border-border"
            }`}
          >
            {isWarmup && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1d1c22" strokeWidth="3">
                <path d="M5 12l5 5L19 7" />
              </svg>
            )}
          </span>
          Warm-up
        </button>
        <button
          onClick={handleAdd}
          disabled={saving}
          className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-60"
        >
          {saving ? "…" : "Add Set"}
        </button>
      </div>
    </div>
  );
}
