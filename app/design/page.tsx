"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardMeta, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { CameraIcon } from "@/components/ui/icons";
import { TextField } from "@/components/ui/input";
import { PendingDot, UploadBar } from "@/components/ui/sync-mark";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabBar } from "@/components/ui/tab-bar";
import { Tabs } from "@/components/ui/tabs";
import { LoadCell } from "@/components/logging/load-cell";
import { RpeSheet } from "@/components/logging/rpe-sheet";
import { ExerciseTarget, SetRow, SetRowHeader } from "@/components/logging/set-row";
import { contrastRatio } from "@/lib/design/contrast";
import type { RpeValue } from "@/lib/logging/set";
import { Caption, Panel, Rule } from "./section";

const SURFACES = [
  ["background", "#1d1c22"],
  ["surface", "#26252c"],
  ["surface-2", "#302e37"],
  ["border", "#3a3840"],
] as const;

const INK = [
  ["foreground", "#f2f1ef"],
  ["muted", "#a5a4a9"],
  ["muted-2", "#96969b"],
  ["success", "#6fa787"],
] as const;

const FILLS = [
  ["accent-fill", "#bc8c5e", "#1d1c22"],
  ["accent-pressed", "#92603f", "#f2f1ef"],
  ["danger-fill", "#b24c42", "#f2f1ef"],
] as const;

const LINES = [
  ["accent-line", "#a77449"],
  ["danger-line", "#c2645a"],
] as const;

export default function DesignSystemPage() {
  const [tab, setTab] = useState("squat");
  const [rpe, setRpe] = useState<RpeValue | null>(8);
  const [logged, setLogged] = useState(false);

  return (
    <main className="flex flex-col gap-20 p-8 md:p-16">
      <header className="flex max-w-[720px] flex-col gap-3.5">
        <h1 className="m-0 text-display font-semibold">Sticks N Boulders — component library</h1>
        <Caption>
          Athlete 390 × 852 · Coach 1440 × 900 · dark only. Every component below is the real one
          the app imports, not a copy.
        </Caption>
      </header>

      <div className="flex flex-wrap items-start gap-8">
        <Panel label="Colour">
          <div className="grid grid-cols-4 gap-3">
            {SURFACES.map(([name, hex]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <span
                  style={{ background: hex }}
                  className="block h-11 rounded-chip border border-border"
                />
                <Caption>
                  {name}
                  <br />
                  {hex}
                </Caption>
              </div>
            ))}
            {INK.map(([name, hex]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <span
                  style={{ color: hex }}
                  className="flex h-11 items-center justify-center rounded-chip bg-surface-2 text-ui font-semibold"
                >
                  Aa {contrastRatio(hex, "#302e37").toFixed(2)}
                </span>
                <Caption>
                  {name}
                  <br />
                  {hex}
                </Caption>
              </div>
            ))}
            {FILLS.map(([name, hex, ink]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <span
                  style={{ background: hex, color: ink }}
                  className="flex h-11 items-center justify-center rounded-chip text-caption font-bold"
                >
                  Aa {contrastRatio(ink, hex).toFixed(2)}
                </span>
                <Caption>
                  {name}
                  <br />
                  {hex}
                </Caption>
              </div>
            ))}
            {LINES.map(([name, hex]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <span
                  style={{ borderColor: hex, color: hex }}
                  className="flex h-11 items-center justify-center rounded-chip border-2 text-value-lg font-semibold"
                >
                  24
                </span>
                <Caption>
                  {name}
                  <br />
                  {hex}
                </Caption>
              </div>
            ))}
          </div>
          <p className="m-0 text-caption text-muted-2">
            The line tokens are 4.22:1 and 4.24:1. They carry no small text anywhere — borders, icon
            strokes, chart lines and 24px+ figures only. Fills carry their own labels and are the
            only members of the pair allowed behind one. muted-2 is #96969b, not the canvas
            #8a898f, which failed AA on both raised surfaces.
          </p>

          <Rule />

          <h2 className="m-0 font-mono text-label text-muted-2 uppercase">
            Type — Archivo, tabular lining figures
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3.5">
              <span className="text-hero font-bold">212.5</span>
              <Caption>hero · 46/700</Caption>
            </div>
            <div className="flex items-baseline gap-3.5">
              <span className="text-value-lg font-semibold">142.5</span>
              <Caption>value-lg · 24/600 · set row</Caption>
            </div>
            <div className="flex items-baseline gap-3.5">
              <span className="text-body">Deadlift, Barbell Row</span>
              <Caption>body · 15/400</Caption>
            </div>
            <div className="flex items-baseline gap-3.5">
              <span className="font-mono text-label text-muted-2">RECENT SETS</span>
              <Caption>label · 10 mono</Caption>
            </div>
          </div>
        </Panel>

        <Panel label="Buttons">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="lg">Start session</Button>
            <Button size="lg" className="bg-accent-pressed text-on-accent-pressed">
              Pressed
            </Button>
            <Button size="lg" disabled>
              Disabled
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="secondary">Secondary</Button>
            <Button variant="secondary" className="border-accent-line bg-surface-2">
              Focus
            </Button>
            <Button variant="ghost">Text</Button>
            <Button variant="danger">Delete set</Button>
          </div>
          <Caption>sm 36 · md 44 · lg 48 · xl 56. Nothing a thumb hits is under 44.</Caption>

          <Rule />
          <h2 className="m-0 font-mono text-label text-muted-2 uppercase">Inputs &amp; chips</h2>
          <div className="flex gap-2.5">
            <TextField placeholder="Type an exercise" />
            <TextField defaultValue="Deadlift" active />
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip onClick={() => {}}>7.5</Chip>
            <Chip tone="selected" onClick={() => {}}>
              8
            </Chip>
            <Chip tone="outline" onClick={() => {}}>
              Not sure
            </Chip>
            <Chip tone="success">On target</Chip>
            <Chip tone="accent">1 PR</Chip>
          </div>
          <Tabs
            label="Lifts"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "squat", label: "Squat" },
              { value: "bench", label: "Bench" },
              { value: "deadlift", label: "Deadlift" },
            ]}
          />

          <Rule />
          <h2 className="m-0 font-mono text-label text-muted-2 uppercase">Sync &amp; upload marks</h2>
          <div className="flex flex-wrap items-center gap-5">
            <span className="flex items-center gap-2">
              <PendingDot />
              <span className="text-sm text-muted">Queued, will sync</span>
            </span>
            <span className="flex items-center gap-2">
              <UploadBar percent={40} className="w-[60px]" />
              <span className="text-sm text-muted">Video uploading</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-ui text-success">✓</span>
              <span className="text-sm text-muted">Logged</span>
            </span>
          </div>
        </Panel>

        <Panel label="Set row — every state" width={420}>
          <div className="flex flex-col gap-2.5">
            <Caption>header + warm-up</Caption>
            <SetRowHeader />
            <SetRow index="W" set={{ loadKg: 60, reps: 5, rpe: null, isWarmup: true }} state="logged" />

            <Caption>logged</Caption>
            <SetRow index={1} set={{ loadKg: 142.5, reps: 5, rpe: 7, isWarmup: false }} state="logged" />

            <Caption>pending sync</Caption>
            <SetRow
              index={2}
              set={{ loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false }}
              state="logged"
              pendingSync
            />

            <Caption>video uploading</Caption>
            <SetRow
              index={3}
              set={{ loadKg: 145, reps: 5, rpe: 8, isWarmup: false }}
              state="logged"
              uploadPercent={62}
            />

            <Caption>prefilled, active — live, tap the tick</Caption>
            <SetRow
              index={4}
              set={{ loadKg: 150, reps: 5, rpe, isWarmup: false }}
              state={logged ? "logged" : "active"}
              note={logged ? null : "suggested from RPE 7 @ 142.5"}
              onConfirm={() => setLogged(true)}
            />
            {logged ? (
              <Button variant="ghost" size="sm" onClick={() => setLogged(false)}>
                Reset
              </Button>
            ) : null}

            <Caption>video required, not filmed — confirm inactive, camera takes the RPE cell</Caption>
            <SetRow
              index={5}
              set={{ loadKg: 180, reps: 3, rpe: null, isWarmup: false, videoRequired: true }}
              state="active"
            />
          </div>

          <Rule />
          <h2 className="m-0 font-mono text-label text-muted-2 uppercase">Load cell</h2>
          <div className="flex items-center gap-3">
            <LoadCell value={142.5} size="logged" label="logged" />
            <LoadCell value={60} size="warmup" label="warm-up" />
            <LoadCell value={150} size="active" editable label="editable" onPress={() => {}} />
            <LoadCell value={null} size="active" editable placeholder="KG" label="empty" onPress={() => {}} />
          </div>
          <Caption>display · warm-up · editable · empty</Caption>

          <Rule />
          <h2 className="m-0 font-mono text-label text-muted-2 uppercase">Exercise block</h2>
          <div className="flex flex-col gap-0.5">
            <div className="text-wordmark font-semibold">Squat</div>
            <ExerciseTarget scheme="Target 3 × 5 @ 75%" resolvedKg={142.5} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="w-12 px-0" aria-label="Film a set">
              <span className="text-accent-line">
                <CameraIcon />
              </span>
            </Button>
            <Button variant="secondary" className="flex-1">
              Add set
            </Button>
            <Button variant="ghost" className="flex-1 border border-border bg-surface">
              Add note
            </Button>
          </div>
        </Panel>

        <Panel label="Athlete frame — 390 × 852, true baseline" width={438}>
          <Caption>
            The real width the set row has to survive: 390pt with 16px gutters. Not a scaled
            preview — this is the viewport the athlete holds.
          </Caption>
          <div
            data-shot="athlete-frame"
            className="flex h-[852px] w-[390px] flex-col overflow-hidden rounded-card border border-border bg-background"
          >
            <div className="flex flex-none items-center justify-between px-4 py-3">
              <span className="text-body font-semibold">Week 3 Day 2</span>
              <span className="flex flex-col items-end">
                <span className="text-action font-semibold">0:47:12</span>
                <span className="font-mono text-label-xs text-muted-2">TAP TO FINISH</span>
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-3.5 overflow-hidden px-4">
              <div className="flex flex-col gap-0.5">
                <div className="text-wordmark font-semibold">Squat</div>
                <ExerciseTarget scheme="Target 3 × 5 @ 75%" resolvedKg={142.5} />
              </div>
              <div className="flex flex-col gap-1.5">
                <SetRowHeader />
                <SetRow index="W" set={{ loadKg: 60, reps: 5, rpe: null, isWarmup: true }} state="logged" />
                <SetRow index={1} set={{ loadKg: 142.5, reps: 5, rpe: 7, isWarmup: false }} state="logged" />
                <SetRow
                  index={2}
                  set={{ loadKg: 142.5, reps: 5, rpe: 8, isWarmup: false }}
                  state="logged"
                  pendingSync
                />
                {/* 347.5 is the widest realistic load: a heavy deadlift in kilos. */}
                <SetRow
                  index={3}
                  set={{ loadKg: 347.5, reps: 5, rpe: null, isWarmup: false }}
                  state="active"
                  note="suggested from RPE 7 @ 142.5"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="w-12 px-0" aria-label="Film a set">
                  <span className="text-accent-line">
                    <CameraIcon />
                  </span>
                </Button>
                <Button variant="secondary" className="flex-1">
                  Add set
                </Button>
                <Button variant="secondary" className="flex-1 text-muted">
                  Add note
                </Button>
              </div>
            </div>
            <TabBar />
          </div>
        </Panel>

        <Panel label="Athlete shell — tab bar" width={390}>
          <Caption>
            Four tabs, no more. Bodyweight, Lift Detail, My Program and Coach Feedback are reached
            from inside them. Links point at routes that do not exist yet.
          </Caption>
          <div className="overflow-hidden rounded-card border border-border">
            <div className="flex h-24 items-center justify-center bg-background text-caption text-muted-2">
              page content
            </div>
            <TabBar />
          </div>
        </Panel>

        <Panel label="RPE sheet" width={390}>
          <Caption>Eleven answers, one sheet, no scrolling. Live — current value: {rpe ?? "not sure"}</Caption>
          <RpeSheet setIndex={4} value={rpe} onSelect={setRpe} />
        </Panel>

        <Panel label="Cards, table, empty state">
          <div className="flex gap-3">
            <Card className="flex-1">
              <CardTitle>Session card</CardTitle>
              <CardBody>Squat, Bench, Barbell Row</CardBody>
              <CardMeta>12 sets · 6,100 kg</CardMeta>
            </Card>
            <Card attention className="flex-1">
              <CardTitle>Needs you</CardTitle>
              <span className="text-title font-semibold">3 videos to review</span>
              <span className="text-caption text-muted-2">Last logged today</span>
            </Card>
          </div>

          <Rule />
          <Table columns="1.4fr 1fr 1fr 1fr">
            <TableHead>
              <TableHeader sorted="asc">Name</TableHeader>
              <TableHeader>This week</TableHeader>
              <TableHeader>Videos</TableHeader>
              <TableHeader>Bodyweight</TableHeader>
            </TableHead>
            <TableRow>
              <TableCell strong>Joey Pang</TableCell>
              <TableCell>3 of 4</TableCell>
              <TableCell strong>3 new</TableCell>
              <TableCell>
                82.4 <span className="text-success">+0.3</span>
              </TableCell>
            </TableRow>
            <TableRow striped>
              <TableCell strong>Sam Tierney</TableCell>
              <TableCell>
                <span className="flex items-center gap-[7px]">
                  <span className="block size-[7px] rounded-full bg-danger-line" />
                  <span className="font-semibold">0 of 4</span>
                </span>
              </TableCell>
              <TableCell>
                <span className="text-muted-2">—</span>
              </TableCell>
              <TableCell>
                88.1 <span className="font-semibold">−1.2</span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell strong>Alex Moran</TableCell>
              <TableCell>4 of 4</TableCell>
              <TableCell strong>1 new</TableCell>
              <TableCell>
                74.9 <span className="text-success">+0.1</span>
              </TableCell>
            </TableRow>
          </Table>

          <Rule />
          <EmptyState
            title="No athletes yet"
            body="Share your invite code and they will appear here as they join."
            action={<Button>Copy invite code</Button>}
          />
          <p className="m-0 text-caption text-muted-2">
            No illustration, no apology, no upsell. An empty screen states the fact and offers at
            most one action.
          </p>
        </Panel>
      </div>
    </main>
  );
}
