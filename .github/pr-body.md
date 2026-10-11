## fix(pwa): offline works again on webpack builds, plus a `check:sw` build gate

The service worker's install failed on every webpack production build, so the athlete app had no offline shell. Found by the 2026-10-09 e2e audit (`e2e:pwa`, 9 fails, §1.5 and P0-1).

### Root cause

`public/sw.js` pulled asset URLs out of each shell page's HTML with

```js
const ASSET = /\/_next\/static\/[^"'\s\\)<>]+/g;   // stops at ')'
```

Webpack names route-group chunks after their folder, e.g. `/_next/static/chunks/app/(athlete)/layout-<hash>.js`. The regex cut that to `/_next/static/chunks/app/(athlete`, which 404s. `statics.addAll` is all or nothing, so the install rejected, no worker activated and nothing took control. `/today`'s page chunk sits under `(athlete)` too, so both collapsed to the same broken URL.

Turbopack builds are not affected *today*, but only because Turbopack emits flat hashed names (`chunks/0cz1d0mv5g_q7.js`). Nothing in the worker made that safe.

### What changed

1. **`public/sw.js`.** The extraction is now a named function, `assetsIn(html)`, still plain JavaScript with no exports and no build step. Parentheses are allowed in pairs, so `(athlete)` survives while the `)` that closes a CSS `url(...)` still ends the URL. `&amp;` is decoded so the cached key matches what the browser requests. Quotes, whitespace, backslashes (the RSC payload's escaped quotes) and angle brackets still end a URL. Brackets (`[sessionId]`) were already allowed.
2. **`scripts/sw-precache.ts`.** Runs the real `public/sw.js` in a bare `node:vm` context and reads back its own `SHELL_PAGES` and `assetsIn`, so the test and the gate can't drift from the worker. `checkPrecache(distDir)` maps each shell page to `.next/server/app/<page>.html`, extracts its assets and checks each one exists under `.next/static`.
3. **`npm run check:sw`** (`scripts/check-sw.mts`). This is the build gate. Run it after any `next build`. It needs no server and no browser, and it fails on a missing page or asset.
4. **`docs/pwa.md`.** One paragraph on why the gate exists.

### How tested

- **Unit (`scripts/sw-precache.test.ts`, 10 tests).** The fixture uses the HTML shapes from a real webpack build: `(athlete)` layout and page chunks, `(coach)`, `?dpl=`, `&amp;`, `[sessionId]`, an RSC payload with escaped quotes, and a CSS `url()`. **Failing first:** on the refactor-only commit (old regex), 4 of 10 fail. **Mutation check:** restoring the old regex fails the same 4. Allowing `)` unconditionally fails 2 (the CSS `url()` and the balanced-paren checks).
- **Build gate, webpack (`npx next build --webpack`):**
  - unfixed: `asset /_next/static/chunks/app/(athlete (from /today): no such file`, then `check:sw failed (webpack build)`, exit 1
  - fixed: `check:sw ok (webpack build): 34 assets across the shell pages, all present.`
- **Build gate, Turbopack (`npm run build`):** `check:sw ok (turbopack build): 26 assets across the shell pages, all present.` It passes with both the old and the new regex, which confirms the flat naming.
- `npm test`: 170 files, 2640 tests pass. `npm run lint` and `npx tsc --noEmit` are clean.
- **Not run:** `e2e:pwa`, which needs the live instance.

### For Joey to decide

- **Wire the gate into the build?** `check:sw` is a standalone script for now. It could become `"build": "next build && npm run check:sw"` (or a `postbuild`) so a bad build can't ship. I left `build` alone because it is your deploy command.
- **Half-written caches on a failed install.** The audit's fix #2 is still open. The shell cache is written before `statics.addAll` throws and is never deleted. It's harmless now that the install succeeds, but it's a separate change if you want it.
- **`e2e:pwa` harness fixes** (wait on `serviceWorker.ready`, assert the served build id matches HEAD) are not in this PR. The audit found the :3100 server was a stale 7 Oct build. Rebuild :3100 from this branch before re-running `e2e:pwa`.
- **Which bundler is production on?** `npm run build` is Turbopack in Next 16, while the worktrees build with `--webpack`. The fix and the gate cover both.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
