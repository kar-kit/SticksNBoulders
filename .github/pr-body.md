## FTP1-10 — Rest timer (Order 10)

> *"Table stakes against Strong. Keep it simple, no custom timer configuration, that was cut from the Strong feature set on purpose."*

Two minutes, `+30s`, and a way to skip it. No per-exercise defaults, no presets, no settings screen.

```
+----------------------------------------+
|  2  [ 140 ]  [ 5 ]  [RPE]      [  ✓  ] |   <- active row
|                                        |
|  REST  1:53          [ +30s ]    Skip  |   <- appears on logging a set
+----------------------------------------+
|   Today     Log     History      Me    |
+----------------------------------------+
```

### A function of the clock, never a counter

Same lesson as the session clock. The timer is `startedAt + restMs - now`, so a phone that slept through the rest, took a call, or threw the page away comes back showing the truth rather than whatever a tick counter managed to count. There is no interval in `lib/logging/rest-timer.ts` and there should never be one — the screen's existing one-second clock drives the display.

`+30s` lengthens the **rest**, not a remaining counter, so it is additive across taps (three presses is ninety seconds) and it works on a rest that has already run out.

Past zero it counts up rather than stopping or vanishing. The useful question between sets isn't *has the rest finished* — it finished, that's why the number turned — but *how far over am I*. The number changes weight rather than colour, because every colour that reads as "over" also reads as "wrong", and resting longer is not a mistake.

### The bottom of the screen is the part worth reviewing

Logging a set is the same instant the timer starts **and** the next-exercise box comes back. Both in the thumb zone pushes one of them out of it.

So the bottom slot now has one precedence expression instead of conditions scattered through the JSX, ordered by how committed the athlete already is:

| | wins over |
| --- | --- |
| Number pad / RPE sheet | everything — the thumb is already on it |
| Finish confirmation | you're on your way out |
| Rest timer | |
| Add-exercise typeahead | |

Side effect worth naming: confirming a finish no longer renders the typeahead underneath it, which it did before.

### Two calls the blueprint doesn't make

Both taken toward less to learn:

- **Every logged set starts it, warm-ups included.** Any other rule is one an athlete has to work out.
- **Undoing a set cancels the rest it started.**

### Persistence

A rest survives a reload — on a PWA that is an ordinary thing to happen between sets — and is forgotten after an hour, so a phone reopened the next morning doesn't show a timer that has been counting up all night. Writing that turned up a fourth copy of the same localStorage try/catch, so the three existing caches (remembered user, exercise library, active session) now share `lib/local-store.ts`.

### Not built

The Log Session blueprint's Notes also say *"Screen must stay awake while a session is active."* That's a Wake Lock call, it has no Order row of its own, and it isn't this ticket — flagging it rather than folding it in. **Joey: say the word and it's a ten-line follow-up.** Worth noting Order 40 already owns "verify offline logging survives airplane mode on a real phone", which is where it would get tested anyway.

No `rest_seconds` field on any row, no sound, no vibration. `navigator.vibrate` is a no-op on iOS Safari, which is the device this is for.

### Verification

```
npm test               713 passed (49 files)
npm run e2e:session     32/32
npm run e2e:offline     31/31
npm run e2e:shell       15/15
npm run perf:check      interactive 629ms on Slow 4G
```

The reload assertion is the one that earns its keep — it's what catches a tick counter sneaking back in:

```
The rest timer
  PASS  starts when a set is logged
  PASS  and takes the bottom of the screen rather than stacking on the typeahead
  PASS  +30s extends it

After throwing the page away
  PASS  and the rest timer is still counting the same rest
  PASS  skipping it gives the typeahead back
```

`e2e:offline` needed one change: adding an exercise now skips the rest on the way, because they share that slot. That's the athlete's path too, not a test workaround.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
