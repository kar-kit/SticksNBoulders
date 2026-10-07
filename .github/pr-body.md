## fix(video): fail loudly at startup when VIDEO_TICKET_SECRET is missing

### Why

Clip playback signs its URLs with `VIDEO_TICKET_SECRET`. When it is unset the
app builds and boots normally, then every coach playback request fails with one
server log line, and the review screen says only "The video for this clip could
not be loaded". Nothing points at the cause. It cost real debugging time, and
the unit tests could not catch it because they inject the secret.

### What changes

- `instrumentation.ts` (new, repo root; there is no `src/`) runs on the Node
  runtime only and calls `checkVideoTicketSecret`. A production start throws
  with a message naming `VIDEO_TICKET_SECRET` and `openssl rand -base64 48`.
  Development logs a single `console.warn`, so `next dev` still works.
- `lib/video/startup-check.ts` (new) holds the decision as a pure function of
  `{ env, nodeEnv, phase }`. It asks `ticketSecret()` rather than restating the
  32-character rule, so there is still one place to change it.
- `docs/review-queue.md` says a production start refuses to boot without it.
- `next build` is unaffected. Next skips the instrumentation hook itself while
  `NEXT_PHASE` is `phase-production-build` (`instrumentation-globals.external.js`,
  `registerInstrumentation`), and the check repeats that exemption so it does
  not depend on a framework detail. CI needs no secret.

`register()` is awaited by `NextNodeServer.prepareImpl`, so a throw stops
`next start` before it accepts requests. That is read from Next's source, not
observed; see below.

### How to verify

1. `npm test -- lib/video/startup-check` : 10 tests (missing, empty, 31 chars,
   exactly 32, 64, prod vs dev, build phase, other phases).
2. Build without the secret, which must still succeed:
   `env -u VIDEO_TICKET_SECRET npm run build`
3. Prod refuses: `env -u VIDEO_TICKET_SECRET npx next start -p 3199`
   should exit non-zero with the message above. Check `.env.local` does not
   supply one, since Next loads it. [Not run by the author.]
4. Prod boots with one: `VIDEO_TICKET_SECRET=$(openssl rand -base64 48) npx next start -p 3199`.
5. Dev warns once: `env -u VIDEO_TICKET_SECRET npx next dev` logs
   `[startup] VIDEO_TICKET_SECRET is missing...` and carries on.

### Heads-up for deploys

Any production environment without the secret will now fail to start instead of
starting broken. Set it on the host before this ships.

### Not covered

`instrumentation.ts` itself has no unit test: vitest only collects tests under
`app/ appwrite/ components/ lib/ scripts/`, and the file is a thin wrapper
around the tested function. Steps 2 to 5 above are the check on the wiring.
