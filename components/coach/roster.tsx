"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import { DepartureNotice } from "@/components/coach/departure-notice";
import { InviteCodePanel } from "@/components/coach/invite-code";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/lib/auth/session-context";
import { fetchCoachLinks, subscribeToLinks } from "@/lib/coach/coach-links-store";
import { sameAthletes, type CoachLinkRecord } from "@/lib/coach/link-status";
import {
  buildRoster,
  changeLabel,
  DEFAULT_SORT,
  nextSort,
  sortRows,
  weekLabel,
  type RosterInputs,
  type RosterRow,
  type Sort,
  type SortKey,
} from "@/lib/coach/roster";
import { fetchRoster } from "@/lib/coach/roster-store";
import { needsYou, type NeedsYouItem } from "@/lib/coach/roster-triggers";
import { shortDate } from "@/lib/coach/athlete-view";
import { dayDate } from "@/lib/bodyweight/bodyweight";
import { subscribeToClips } from "@/lib/review/queue-store";
import { cn } from "@/lib/cn";

/**
 * The Roster. Order 24, blueprint 10: Ruairi's landing page.
 *
 * Walk in cold and know within five seconds who needs attention. So the
 * "needs you" list comes first and is computed, never a to-do list a coach
 * keeps by hand; the table under it is dense, sortable and has no charts.
 *
 * Every read is the coach's own session through the athletes' circle teams.
 * The athlete list starts from the session (no extra round trip on first
 * paint) and is checked against a fresh, uncached read of the coach's links,
 * live: an athlete who unlinks leaves the table and the rail in the same
 * moment, and the departure notice says so without naming them (Order 16.6).
 */

type Data = { key: string; now: Date; inputs: Omit<RosterInputs, "links"> } | { key: string; failed: true };

const COLUMNS = "minmax(160px,1.4fr) minmax(150px,1fr) minmax(90px,0.6fr) minmax(150px,1fr) minmax(120px,1fr)";

export function Roster() {
  const { state: session, refresh } = useSession();
  const coachId = session.status === "signed-in" ? session.user.id : null;
  const sessionIds = useMemo(
    () => (session.status === "signed-in" ? session.coach.athleteIds : []),
    [session],
  );
  const key = [...sessionIds].sort().join(",");

  const [links, setLinks] = useState<CoachLinkRecord[] | null>(null);
  const [linkTick, setLinkTick] = useState(0);
  const [dataTick, setDataTick] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);

  const sessionIdsRef = useRef(sessionIds);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    sessionIdsRef.current = sessionIds;
    refreshRef.current = refresh;
  });

  // The fresh link read. When it disagrees with the session -- an athlete
  // linked or left since the app loaded -- the session is refreshed, which
  // re-keys the data read below and corrects the rail at the same time.
  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    void fetchCoachLinks(coachId)
      .then((records) => {
        if (cancelled) return;
        setLinks(records);
        const active = records.filter((r) => r.status === "active").map((r) => r.athleteId);
        if (!sameAthletes(active, sessionIdsRef.current)) void refreshRef.current().catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coachId, linkTick]);

  useEffect(() => {
    if (!coachId || sessionIds.length === 0) return;
    let cancelled = false;
    const now = new Date();
    void fetchRoster(coachId, sessionIds, now)
      .then((inputs) => {
        if (!cancelled) setData({ key, now, inputs });
      })
      .catch(() => {
        if (!cancelled) setData({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // `key` is the content of sessionIds; depending on the array would refetch
    // on every session object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachId, key, dataTick]);

  // Live: links for who is on the roster, clips for the videos column.
  useEffect(() => {
    if (!coachId) return;
    try {
      const { databaseId } = browserAppwrite();
      const stopLinks = subscribeToLinks(databaseId, () => setLinkTick((n) => n + 1));
      const stopClips = subscribeToClips(databaseId, () => setDataTick((n) => n + 1));
      return () => {
        stopLinks();
        stopClips();
      };
    } catch {
      // Realtime is an improvement, not a dependency.
      return;
    }
  }, [coachId]);

  if (!coachId) return null;

  // Fresh links win over the session; until they arrive the session stands in.
  const activeIds = links
    ? links.filter((r) => r.status === "active").map((r) => r.athleteId)
    : sessionIds;

  if (activeIds.length === 0) return <RosterEmpty links={links} />;

  const current = data && data.key === key ? data : null;
  if (!current) {
    return (
      <p className="m-0 p-8 text-ui text-muted" aria-busy>
        Loading…
      </p>
    );
  }
  if ("failed" in current) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <EmptyState title="Couldn’t load your roster" body="Check your connection and refresh to try again." />
      </div>
    );
  }

  // Only athletes who are active on the fresh read AND were fetched. One who
  // left is filtered out here, before the session refresh lands.
  const linkedAt = new Map((links ?? []).map((r) => [r.athleteId, r.linkedAt ? new Date(r.linkedAt) : null]));
  const fetched = new Set(sessionIds);
  const rosterLinks = activeIds
    .filter((id) => fetched.has(id))
    .map((athleteId) => ({ athleteId, linkedAt: linkedAt.get(athleteId) ?? null }));

  const { rows, signals } = buildRoster({ links: rosterLinks, ...current.inputs }, current.now);
  const items = needsYou(signals, current.now);

  return (
    <div className="flex flex-col gap-8 p-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="m-0 text-display font-semibold">Roster</h1>
        <span className="text-ui text-muted">
          {rows.length} athlete{rows.length === 1 ? "" : "s"}
        </span>
      </header>

      <NeedsYou items={items} />

      <section aria-labelledby="roster-everyone" className="flex flex-col gap-3">
        <h2 id="roster-everyone" className="m-0 text-label uppercase tracking-wide text-muted">
          Everyone
        </h2>
        <RosterTable rows={sortRows(rows, sort)} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} />
      </section>

      <DepartureNotice records={links} />
    </div>
  );
}

/** Ruairi's first session is this screen. The code is its one action. */
function RosterEmpty({ links }: { links: CoachLinkRecord[] | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <EmptyState
        title="No athletes yet"
        body="Share your invite code and they'll appear here as they join, with whatever needs your attention first."
        action={<InviteCodePanel labelled={false} />}
      />
      <DepartureNotice records={links} />
    </div>
  );
}

function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  return (
    <section aria-labelledby="roster-needs-you" className="flex flex-col gap-3">
      <h2 id="roster-needs-you" className="m-0 text-label uppercase tracking-wide text-muted">
        Needs you
      </h2>
      {items.length === 0 ? (
        // The good outcome, said as one.
        <p className="m-0 text-body text-muted">Nothing needs you today.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((item) => (
            <li key={`${item.athleteId}:${item.kind}`}>
              <Link
                href={item.href}
                className="flex h-10 items-center gap-3 rounded-chip px-3 text-ui hover:bg-surface focus-visible:bg-surface"
              >
                <span aria-hidden className="block size-1.5 flex-none rounded-full bg-accent-line" />
                <span className="font-semibold">{item.athleteName}</span>
                <span className="text-muted">{item.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const HEADERS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Athlete" },
  { key: "week", label: "This week" },
  { key: "videos", label: "Videos" },
  { key: "bodyweight", label: "Bodyweight" },
  { key: "block", label: "Block" },
];

function RosterTable({ rows, sort, onSort }: { rows: RosterRow[]; sort: Sort; onSort: (key: SortKey) => void }) {
  return (
    <div
      role="table"
      aria-label="Athletes"
      className="overflow-hidden rounded-control border border-border"
      style={{ "--table-cols": COLUMNS } as React.CSSProperties}
    >
      <div
        role="row"
        className="grid h-[34px] items-center gap-3 border-b border-border bg-surface px-[14px]"
        style={{ gridTemplateColumns: "var(--table-cols)" }}
      >
        {HEADERS.map(({ key, label }) => {
          const sorted = sort.key === key ? sort.dir : undefined;
          return (
            <span
              key={key}
              role="columnheader"
              aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
            >
              <button
                type="button"
                onClick={() => onSort(key)}
                className={cn(
                  "font-mono text-label-xs uppercase",
                  sorted ? "text-foreground" : "text-muted-2",
                )}
              >
                {label}
                {sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : null}
              </button>
            </span>
          );
        })}
      </div>
      {rows.map((row) => (
        <Link
          key={row.athleteId}
          href={`/coach/athletes/${row.athleteId}`}
          role="row"
          className="grid h-[42px] items-center gap-3 border-b border-border px-[14px] text-ui last:border-b-0 hover:bg-surface focus-visible:bg-surface"
          style={{ gridTemplateColumns: "var(--table-cols)" }}
        >
          <span role="cell" className="truncate font-semibold">
            {row.name}
          </span>
          {row.visible ? (
            <>
              <span role="cell" className={cn(row.sessionsThisWeek === 0 && "text-muted")}>
                {weekLabel(row)}
              </span>
              <span role="cell" className={cn("font-mono", row.videosWaiting === 0 && "text-muted-2")}>
                {row.videosWaiting === 0 ? "—" : row.videosWaiting}
              </span>
              <span role="cell">
                <BodyweightCell row={row} now={new Date()} />
              </span>
              <span role="cell" className={cn(!row.block && "text-muted-2")}>
                {row.block ?? "No block"}
              </span>
            </>
          ) : (
            <span role="cell" className="col-span-4 text-muted">
              Linked, nothing showing yet
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

function BodyweightCell({ row, now }: { row: RosterRow; now: Date }) {
  const bw = row.bodyweight;
  if (!bw) return <span className="text-muted-2">None logged</span>;
  if (bw.stale) {
    // No trend for a week with no weigh-ins in it -- the last number and its
    // day instead, same rule as the Bodyweight screen.
    return (
      <span className="text-muted">
        <span className="font-mono">{bw.latestKg.toFixed(1)}</span> kg · {shortDate(dayDate(bw.measuredOn), now)}
      </span>
    );
  }
  return (
    <span>
      <span className="font-mono">{bw.latestKg.toFixed(1)}</span> kg
      {bw.changeKg !== null ? (
        <span className="ml-2 font-mono text-muted">{changeLabel(bw.changeKg)}</span>
      ) : null}
    </span>
  );
}
