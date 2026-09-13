"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Query, type Models } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB, teams as teamsService } from "@/lib/appwrite";
import { DATABASE_ID, TABLES } from "@/lib/constants";
import type { BodyweightCheckIn, Lift, WorkoutSet } from "@/lib/types";
import { computeBest1RM } from "@/lib/lift-stats";
import { displayWeight } from "@/lib/units";
import { isSameWeek } from "@/lib/dates";
import PageSpinner from "@/components/PageSpinner";

export default function DashboardPage() {
  const { user, profile, loading } = useRequireAuth();

  const [teams, setTeams] = useState<Models.Team<Models.Preferences>[]>([]);
  const [latestCheckIn, setLatestCheckIn] = useState<BodyweightCheckIn | null>(null);
  const [bests, setBests] = useState<{ lift: Lift; estimatedKg: number }[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user || !profile) return;

    (async () => {
      const [teamList, checkIns, lifts, sets] = await Promise.all([
        teamsService.list(),
        tablesDB.listRows<BodyweightCheckIn>(DATABASE_ID, TABLES.bodyweightCheckins, [
          Query.equal("userId", user.$id),
          Query.orderDesc("weekOf"),
          Query.limit(1),
        ]),
        tablesDB.listRows<Lift>(DATABASE_ID, TABLES.lifts),
        tablesDB.listRows<WorkoutSet>(DATABASE_ID, TABLES.workoutSets, [
          Query.equal("userId", user.$id),
          Query.orderDesc("date"),
          Query.limit(200),
        ]),
      ]);

      setTeams(teamList.teams);
      setLatestCheckIn(checkIns.rows[0] ?? null);

      const setsByLift = new Map<string, WorkoutSet[]>();
      for (const set of sets.rows) {
        const list = setsByLift.get(set.liftId) ?? [];
        list.push(set);
        setsByLift.set(set.liftId, list);
      }
      const nextBests = lifts.rows
        .map((lift) => {
          const best = computeBest1RM(setsByLift.get(lift.$id) ?? []);
          return best ? { lift, estimatedKg: best.estimatedKg } : null;
        })
        .filter((v): v is { lift: Lift; estimatedKg: number } => v !== null);
      setBests(nextBests);
      setLoadingData(false);
    })();
  }, [user, profile]);

  if (loading || !profile) return <PageSpinner />;

  const checkedInThisWeek = latestCheckIn ? isSameWeek(new Date(latestCheckIn.weekOf)) : false;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-8 px-5 pt-safe-8 pb-8">
      <div>
        <p className="text-sm text-muted">Welcome back</p>
        <h1 className="text-2xl font-semibold">{profile.displayName || user?.name || "Lifter"}</h1>
      </div>

      <Link
        href="/log"
        className="flex h-14 items-center justify-center rounded-2xl bg-accent text-base font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
      >
        Start Workout
      </Link>

      <Link
        href="/checkin"
        className="flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4"
      >
        <div>
          <p className="text-sm font-medium">Weekly check-in</p>
          <p className="text-xs text-muted">
            {checkedInThisWeek ? "Done for this week" : "Not done yet this week"}
          </p>
        </div>
        {!loadingData && (
          <span
            className={`h-2.5 w-2.5 rounded-full ${checkedInThisWeek ? "bg-success" : "bg-danger"}`}
          />
        )}
      </Link>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted">Personal bests</h2>
        {loadingData ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : bests.length === 0 ? (
          <p className="text-sm text-muted">Log a lift to see your bests here.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {bests.map(({ lift, estimatedKg }) => (
              <Link
                key={lift.$id}
                href={`/lifts/${lift.$id}`}
                className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"
              >
                <span className="text-sm">{lift.name}</span>
                <span className="text-sm font-semibold text-accent">
                  {displayWeight(estimatedKg, profile.unitPreference)} {profile.unitPreference}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">Your groups</h2>
          <Link href="/groups" className="text-xs text-accent">
            See all
          </Link>
        </div>
        {loadingData ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : teams.length === 0 ? (
          <Link href="/groups" className="text-sm text-accent">
            Join or create a group →
          </Link>
        ) : (
          <div className="flex flex-col gap-2">
            {teams.slice(0, 3).map((team) => (
              <Link
                key={team.$id}
                href={`/groups/${team.$id}`}
                className="rounded-xl bg-surface px-4 py-3 text-sm"
              >
                {team.name}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
