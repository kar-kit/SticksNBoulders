"use client";

import { use, useEffect, useState } from "react";
import type { Models } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB, teams as teamsService } from "@/lib/appwrite";
import { DATABASE_ID, TABLES, FUNCTIONS } from "@/lib/constants";
import { callFunction } from "@/lib/call-function";
import type { Lift } from "@/lib/types";
import { displayWeight } from "@/lib/units";
import PageSpinner from "@/components/PageSpinner";

interface LeaderboardEntry {
  userId: string;
  name: string;
  estimated1RMKg: number;
  bodyweightKg: number;
  dots: number;
}

export default function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team: preselectedTeam } = use(searchParams);
  const { user, profile, loading } = useRequireAuth();

  const [teams, setTeams] = useState<Models.Team<Models.Preferences>[]>([]);
  const [lifts, setLifts] = useState<Lift[]>([]);
  const [teamId, setTeamId] = useState("");
  const [liftId, setLiftId] = useState("");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamsLoaded, setTeamsLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [teamList, liftRows] = await Promise.all([
        teamsService.list(),
        tablesDB.listRows<Lift>(DATABASE_ID, TABLES.lifts),
      ]);
      setTeams(teamList.teams);
      setLifts(liftRows.rows);
      setTeamId((current) => current || preselectedTeam || teamList.teams[0]?.$id || "");
      setLiftId((current) => current || liftRows.rows[0]?.$id || "");
      setTeamsLoaded(true);
    })();
  }, [user, preselectedTeam]);

  useEffect(() => {
    if (!teamId || !liftId) return;
    (async () => {
      setLoadingBoard(true);
      setError(null);
      try {
        const res = await callFunction<{ entries: LeaderboardEntry[] }>(FUNCTIONS.leaderboard, {
          teamId,
          liftId,
        });
        setEntries(res.entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoadingBoard(false);
      }
    })();
  }, [teamId, liftId]);

  if (loading || !profile || !teamsLoaded) return <PageSpinner />;

  if (teams.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-safe-8 pb-8">
        <h1 className="text-xl font-semibold">Leaderboards</h1>
        <p className="text-sm text-muted">Join or create a group to see a leaderboard.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 px-5 pt-safe-8 pb-8">
      <h1 className="text-xl font-semibold">Leaderboards</h1>

      <select
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        className="h-12 rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-accent"
      >
        {teams.map((t) => (
          <option key={t.$id} value={t.$id}>
            {t.name}
          </option>
        ))}
      </select>

      <div className="flex gap-2 overflow-x-auto">
        {lifts.map((lift) => (
          <button
            key={lift.$id}
            onClick={() => setLiftId(lift.$id)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm ${
              liftId === lift.$id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"
            }`}
          >
            {lift.name}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        Ranked by DOTS score, computed from each member&apos;s best lift and most recent verified
        bodyweight.
      </p>

      {loadingBoard ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-sm text-muted">
          Nobody qualifies yet -- they need a logged set for this lift and a verified weekly
          check-in.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <div
              key={entry.userId}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                entry.userId === user!.$id ? "border border-accent bg-accent/10" : "bg-surface"
              }`}
            >
              <span className="w-5 text-sm font-semibold text-muted">{i + 1}</span>
              <div className="flex-1">
                <p className="text-sm font-medium">{entry.name}</p>
                <p className="text-xs text-muted">
                  {displayWeight(entry.estimated1RMKg, profile.unitPreference)}{" "}
                  {profile.unitPreference}
                </p>
              </div>
              <span className="text-sm font-semibold text-accent">{entry.dots.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
