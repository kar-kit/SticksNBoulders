# Roster (Order 24)

The coach's landing page, blueprint 10. A computed "needs you" list, then one
dense sortable row per linked athlete. No charts.

## Where the numbers come from

Every read is the coach's own Appwrite session through the athletes' circle
teams. No server key, no new tables, nothing written.

| Column | Read | Note |
| --- | --- | --- |
| This week: sessions | `sessions`, finished, started in this London week | one row per session; a count of rows, not a GROUP BY over sets |
| This week: sets | `stats_rollups` for this `week_start`, summed across lifts | working sets only, same rule as the rollups |
| Videos | `sets` with a clip, minus this coach's `set_reviews` | the Review Queue's own two reads |
| Bodyweight | `bodyweight_entries`, last 21 days; newest-ever for anyone with none | trend from `lib/bodyweight`'s window rule |
| Block | `fetchProgramSignals` | the athlete's live published program, decided in `lib/coach/program-signals.ts` (Order 19) |

One query per table for every athlete (`equal()` takes an array). The only
per-athlete calls are the circle check (`canSeeCircle`) and the rare
"newest weigh-in ever".

**Next comp** is in the blueprint and not built: there is no meet or
weight-class data in the MVP (comp planning is February 2027).

## The triggers

All in `lib/coach/roster-triggers.ts`, thresholds in `TRIGGER_RULES`. Every rule
and threshold is **[Inference]** from Ruairi's complaints, not from watching him
work. The one **[Fact]** is the order's first place: videos lead, because his
review day is "Watch videos, analyse weaknesses and then adjust program
accordingly" (his form answer, 6 Oct 2026). Blueprint 10's question on the rest
of his review day is still open.

| Trigger | Rule | Live now? |
| --- | --- | --- |
| Videos | ≥1 clip this coach hasn't cleared, any age | yes |
| Unprompted RPE 10 | an RPE 10 where the prescription asked for less, in the last 7 days | yes, from `fetchProgramSignals` |
| Missed sessions | ≥1 prescribed session this week whose day passed with nothing logged | yes, from `fetchProgramSignals` |
| No bodyweight | last weigh-in more than 7 days ago; never-logged once linked over 7 days | yes |
| Weight-class drift near a meet | in the blueprint | not built, no meet data |

Order on screen (`KIND_ORDER`): videos, unprompted max, missed sessions,
bodyweight; then by name. Videos first is [Fact] (above); the order of the other
three is [Inference] and unchanged. An athlete whose circle the coach can't see
yet fires nothing, because every read for them came back empty and none of that
is a fact about them.

## Order 19 wiring

`fetchProgramSignals` in `lib/coach/roster-store.ts` reads the programs, weeks,
days, sessions and RPE 10 sets for every athlete at once, through the coach's
session, and `computeProgramSignals` in `lib/coach/program-signals.ts` turns
them into one `ProgramSignals` per athlete (block label, missed sessions this
week, recent unprompted RPE 10 sets). The rules and the Block column consume it;
the unit tests cover both rules and the computation.

## Testing

- `npm test`: trigger rules, row building, sorting, and the screen's loading,
  empty, linked, not-visible, failed and revoked states.
- `npm run e2e:roster` (needs a running app, `E2E_BASE_URL`): the columns
  through a real coach session, needs-you, sorting, 1280 fit, a live unlink,
  and a stranger seeing nothing.
