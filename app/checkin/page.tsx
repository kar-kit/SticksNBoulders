"use client";

import { useEffect, useState } from "react";
import { ID, Permission, Query, Role } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { storage, tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES, BUCKETS } from "@/lib/constants";
import type { BodyweightCheckIn } from "@/lib/types";
import { toKg, displayWeight } from "@/lib/units";
import { startOfWeek, isSameWeek } from "@/lib/dates";
import PageSpinner from "@/components/PageSpinner";

async function fetchCheckIns(userId: string) {
  const res = await tablesDB.listRows<BodyweightCheckIn>(DATABASE_ID, TABLES.bodyweightCheckins, [
    Query.equal("userId", userId),
    Query.orderDesc("weekOf"),
    Query.limit(52),
  ]);
  return res.rows;
}

export default function CheckInPage() {
  const { user, profile, loading } = useRequireAuth();

  const [history, setHistory] = useState<BodyweightCheckIn[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [weight, setWeight] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const rows = await fetchCheckIns(user.$id);
      setHistory(rows);
      setLoadingHistory(false);
    })();
  }, [user]);

  if (loading || !profile) return <PageSpinner />;

  const alreadyCheckedInThisWeek = history.some((c) => isSameWeek(new Date(c.weekOf)));

  async function handleSubmit() {
    const weightValue = parseFloat(weight);
    if (!photo || !Number.isFinite(weightValue)) {
      setError("Add a scale photo and your weight.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const permissions = [
        Permission.read(Role.user(user!.$id)),
        Permission.update(Role.user(user!.$id)),
        Permission.delete(Role.user(user!.$id)),
      ];
      const file = await storage.createFile(BUCKETS.bodyweightPhotos, ID.unique(), photo, permissions);
      await tablesDB.createRow(
        DATABASE_ID,
        TABLES.bodyweightCheckins,
        ID.unique(),
        {
          userId: user!.$id,
          weekOf: startOfWeek().toISOString(),
          photoFileId: file.$id,
          declaredWeightKg: toKg(weightValue, profile!.unitPreference),
          visionVerified: false,
          flagged: false,
        },
        permissions
      );
      setWeight("");
      setPhoto(null);
      setHistory(await fetchCheckIns(user!.$id));
    } catch {
      setError("Couldn't save your check-in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <h1 className="text-xl font-semibold">Weekly Check-In</h1>

      {loadingHistory ? (
        <div className="rounded-2xl bg-surface p-4 text-sm text-muted">Loading…</div>
      ) : alreadyCheckedInThisWeek ? (
        <div className="rounded-2xl bg-surface p-4 text-sm text-muted">
          You&apos;re checked in for this week. Come back next week.
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl bg-surface p-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted">Scale photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="text-sm text-muted"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted">Weight ({profile.unitPreference})</span>
            <input
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="h-12 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
              placeholder="0"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit check-in"}
          </button>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted">History</h2>
        {loadingHistory ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">No check-ins yet.</p>
        ) : (
          history.map((c) => (
            <div key={c.$id} className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  Week of {new Date(c.weekOf).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </p>
                <p className="text-xs text-muted">
                  {displayWeight(c.declaredWeightKg, profile.unitPreference)} {profile.unitPreference}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  c.visionVerified
                    ? "bg-success/15 text-success"
                    : c.flagged
                      ? "bg-danger/15 text-danger"
                      : "bg-border text-muted"
                }`}
              >
                {c.visionVerified ? "Verified" : c.flagged ? "Flagged" : "Pending"}
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
