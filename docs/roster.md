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
| Block | `fetchProgramSignals` | **Order 19 seam**, returns nothing yet |

One query per table for every athlete (`equal()` takes an array). The only
per-athlete calls are the circle check (`canSeeCircle`) and the rare
"newest weigh-in ever".

**Next comp** is in the blueprint and not built: there is no meet or
weight-class data in the MVP (comp planning is February 2027).

## The triggers

All in `lib/coach/roster-triggers.ts`, thresholds in `TRIGGER_RULES`. Every one
is **[Inference]** from Ruairi's complaints, not from watching him work
(blueprint 10 is blocked on that question).

| Trigger | Rule | Live now? |
| --- | --- | --- |
| Unprompted RPE 10 | an RPE 10 where the prescription asked for less, in the last 7 days | no, needs Order 19/22 |
| Missed sessions | ≥1 prescribed session this week whose day passed with nothing logged | no, needs Order 19 |
| Videos | ≥1 clip this coach hasn't cleared, any age | yes |
| No bodyweight | last weigh-in more than 7 days ago; never-logged once linked over 7 days | yes |
| Weight-class drift near a meet | in the blueprint | not built, no meet data |

Order on screen: unprompted max, missed sessions, videos, bodyweight; then by
name. An athlete whose circle the coach can't see yet fires nothing, because
every read for them came back empty and none of that is a fact about them.

## Wiring in Order 19

Fill in `fetchProgramSignals` in `lib/coach/roster-store.ts` with
`ProgramSignals` per athlete (block label, missed sessions this week, recent
unprompted RPE 10 sets), read through the coach's session. The rules and the
Block column already consume it; the unit tests already cover both rules.

## Testing

- `npm test`: trigger rules, row building, sorting, and the screen's loading,
  empty, linked, not-visible, failed and revoked states.
- `npm run e2e:roster` (needs a running app, `E2E_BASE_URL`): the columns
  through a real coach session, needs-you, sorting, 1280 fit, a live unlink,
  and a stranger seeing nothing.
