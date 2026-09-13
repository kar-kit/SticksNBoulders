"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import type { Models } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { teams as teamsService } from "@/lib/appwrite";
import { FUNCTIONS } from "@/lib/constants";
import { callFunction } from "@/lib/call-function";
import PageSpinner from "@/components/PageSpinner";

export default function GroupDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const { profile, loading } = useRequireAuth();

  const [team, setTeam] = useState<Models.Team<Models.Preferences> | null>(null);
  const [members, setMembers] = useState<Models.Membership[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [teamRow, memberships] = await Promise.all([
        teamsService.get(teamId),
        teamsService.listMemberships(teamId),
      ]);
      setTeam(teamRow);
      setMembers(memberships.memberships);
    })();
  }, [teamId]);

  async function revealCode() {
    setCodeLoading(true);
    try {
      const res = await callFunction<{ code: string }>(FUNCTIONS.teamInviteCreate, { teamId });
      setCode(res.code);
    } finally {
      setCodeLoading(false);
    }
  }

  if (loading || !profile) return <PageSpinner />;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <Link href="/groups" className="text-sm text-accent">
        ← Groups
      </Link>
      <h1 className="text-xl font-semibold">{team?.name ?? "…"}</h1>

      <Link
        href={`/leaderboards?team=${teamId}`}
        className="flex h-12 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-accent-foreground"
      >
        View leaderboard
      </Link>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted">Members</h2>
        {members.map((m) => (
          <div key={m.$id} className="rounded-xl bg-surface px-4 py-3 text-sm">
            {m.userName || m.userEmail || "Lifter"}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
        <span className="text-sm font-medium text-muted">Invite code</span>
        {code ? (
          <p className="text-center text-2xl font-semibold tracking-widest text-accent">{code}</p>
        ) : (
          <button
            onClick={revealCode}
            disabled={codeLoading}
            className="h-11 rounded-xl border border-border text-sm disabled:opacity-60"
          >
            {codeLoading ? "…" : "Show invite code"}
          </button>
        )}
      </section>
    </div>
  );
}
