"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Query } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES, FUNCTIONS } from "@/lib/constants";
import { callFunction } from "@/lib/call-function";
import PageSpinner from "@/components/PageSpinner";
import type { CoachLink } from "@/lib/types";

export default function CoachDashboardPage() {
  const { user, profile, loading } = useRequireAuth();
  const [athletes, setAthletes] = useState<CoachLink[]>([]);
  const [loadingAthletes, setLoadingAthletes] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    tablesDB
      .listRows<CoachLink>(DATABASE_ID, TABLES.coachLinks, [
        Query.equal("coachUserId", user.$id),
        Query.equal("status", "active"),
      ])
      .then((res) => {
        setAthletes(res.rows);
        setLoadingAthletes(false);
      });
  }, [user]);

  async function revealCode() {
    setCodeLoading(true);
    try {
      const res = await callFunction<{ code: string }>(FUNCTIONS.coachInviteCreate, {});
      setCode(res.code);
    } finally {
      setCodeLoading(false);
    }
  }

  if (loading || !profile) return <PageSpinner />;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <h1 className="text-xl font-semibold">Coach Dashboard</h1>

      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
        <span className="text-sm font-medium text-muted">Your coach code</span>
        {code ? (
          <p className="text-center text-2xl font-semibold tracking-widest text-accent">{code}</p>
        ) : (
          <button
            onClick={revealCode}
            disabled={codeLoading}
            className="h-11 rounded-xl border border-border text-sm disabled:opacity-60"
          >
            {codeLoading ? "…" : "Show my code"}
          </button>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted">Your athletes</h2>
        {loadingAthletes ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : athletes.length === 0 ? (
          <p className="text-sm text-muted">
            Share your coach code with an athlete to link with them.
          </p>
        ) : (
          athletes.map((link) => (
            <Link
              key={link.$id}
              href={`/coach/athletes/${link.athleteUserId}`}
              className="rounded-xl bg-surface px-4 py-3 text-sm"
            >
              {link.athleteName || "Athlete"}
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
