## test(coach): wait for the editor's landing effect instead of assuming it ran

### What was flaky

`components/coach/program-editor-landing.test.tsx` > "opens on the traced week, in its own block, with the traced line focused".

```
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
  at program-editor-landing.test.tsx:109  (expect(scrolled).toHaveBeenCalledTimes(1))
```

Before the fix it failed 2 times in 49 full-suite runs: 1 in 25 sequential default runs, and 1 in 24 runs with two suites going at once (`--sequence.shuffle` alongside `--pool=forks`). It was the only test that failed in any of those runs.

### Why

The test bug is in the test; the source is fine. `ProgramEditor` scrolls to the traced day and focuses the traced line in a `useEffect` that runs once the tree has loaded. The test waited for the day to appear (`findByRole("region", { name: "Heavy squat" })`) and then asserted the scroll straight away. That assumes passive effects have run by the time `findBy*` resolves, which nothing guarantees:

- React 19's scheduler yields after the commit when a 5 ms slice is spent (or when the commit requests a paint). The passive effect flush then runs in a later `setImmediate` task.
- RTL's `findBy*` resolves one `setTimeout(0)` after the commit's DOM mutation (`asyncWrapper` in `@testing-library/react` 16.3).

Usually the effect wins. On a busy machine the timer sometimes fires first, and the test sees `scrolled` called 0 times. The row's accessible name (`"Heavy squat line 2: Squat"`) had a second, independent race: the exercise name comes from a separate `fetchExerciseLibrary` call.

### Repro (deterministic, not committed)

This is the same scenario in its own file, with React's clock stubbed so the scheduler yields after every unit of work:

```ts
let t = 0;
const spy = vi.spyOn(performance, "now").mockImplementation(() => (t += 10));
render(<ProgramEditor programId="p1" landing={{ weekId: "w3", dayId: "d9", lineId: "l9" }} />);
await screen.findByRole("region", { name: "Heavy squat" });
expect(scrolled).toHaveBeenCalledTimes(1); // old pattern: 20/20 fail
// await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1)); // new pattern: 0/20 fail
```

Without the stub the same file passes every time. The repro is not in the suite because it is only deterministic as the first render in a fresh worker. When it ran after another test in the same file, it caught the old pattern in only 1 of 5 runs, then 2 of 10. My best explanation, unproven: the jumping clock also ages scheduler tasks into "expired", and expired tasks run without yielding. A guard that flaky would be the problem we started with.

### Fix

The test now waits for what the effect produces: `await waitFor(...)` on the `scrollIntoView` call, then checks focus, then `await waitFor(...)` on the row's accessible name. There are no retries, timeout changes or skips. The assertions are unchanged; only their timing changed.

### Verification

- 30 consecutive sequential full runs: **30/30 green**, 2556/2556 each
- 5 full runs with `--sequence.shuffle`: **5/5 green**
- 16 full runs under load (two suites at once, one shuffled, one `--pool=forks`): **16/16 green**
- `npm run typecheck` and `eslint` on the changed file: clean.

### Known gap, not fixed here

The second test in that file ("opens where it always did...") asserts `scrolled` was *not* called, straight after `findByRole`. It shares the same race, but there it can only pass when it shouldn't, never fail. A landing that wrongly scrolled could slip through on a busy machine. Making it airtight needs a signal that effects have flushed, which the editor doesn't expose. I left it alone rather than add a sleep.
