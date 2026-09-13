"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ID, type Models } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { teams as teamsService } from "@/lib/appwrite";
import { FUNCTIONS } from "@/lib/constants";
import { callFunction } from "@/lib/call-function";
import PageSpinner from "@/components/PageSpinner";

export default function GroupsPage() {
  const { user, profile, loading } = useRequireAuth();
  const [teams, setTeams] = useState<Models.Team<Models.Preferences>[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);

  const [newGroupName, setNewGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await teamsService.list();
    setTeams(res.teams);
    setLoadingTeams(false);
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      const res = await teamsService.list();
      setTeams(res.teams);
      setLoadingTeams(false);
    })();
  }, [user]);

  async function handleCreate() {
    if (!newGroupName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await teamsService.create(ID.unique(), newGroupName.trim());
      setNewGroupName("");
      await refresh();
    } catch {
      setError("Couldn't create that group.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await callFunction(FUNCTIONS.teamInviteRedeem, { code: joinCode.trim() });
      setJoinCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join that group.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !profile) return <PageSpinner />;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <h1 className="text-xl font-semibold">Groups</h1>

      <section className="flex flex-col gap-2">
        {loadingTeams ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : teams.length === 0 ? (
          <p className="text-sm text-muted">You&apos;re not in any groups yet.</p>
        ) : (
          teams.map((team) => (
            <Link
              key={team.$id}
              href={`/groups/${team.$id}`}
              className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"
            >
              <span className="text-sm font-medium">{team.name}</span>
              <span className="text-xs text-muted">{team.total} member{team.total === 1 ? "" : "s"}</span>
            </Link>
          ))
        )}
      </section>

      {error && <p className="text-sm text-danger">{error}</p>}

      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
        <span className="text-sm font-medium text-muted">Create a group</span>
        <div className="flex gap-2">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
            className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={handleCreate}
            disabled={busy}
            className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            Create
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
        <span className="text-sm font-medium text-muted">Join with a code</span>
        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="e.g. 7K3PQMXR"
            className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm uppercase tracking-widest outline-none focus:border-accent"
          />
          <button
            onClick={handleJoin}
            disabled={busy}
            className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60"
          >
            Join
          </button>
        </div>
      </section>
    </div>
  );
}
