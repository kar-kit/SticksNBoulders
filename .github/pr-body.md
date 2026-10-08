## fix(e2e): three race conditions found running the suite against the live instance

First full e2e run after #59 to #67 (against the production build): 8 of 11 runnable scripts passed outright; `e2e:history` and `e2e:shell` each failed on checks that read the page before it had finished drawing. No app bug behind any of them:

- **history** "a card says what the session was": the card paints from the session row and gains exercise names when the sets arrive. The script read it half-drawn. Now waits for the name.
- **shell** "is not asked the first-run question": the landing saves a pre-existing coach's mode without awaiting it; the script read the preference immediately. Now polls for up to 10s.
- **shell** "Programs reaches /coach/programs with a real empty state": read `main` while it still said loading. Review passed the same check by accident, because "Loading the queue…" is non-empty text. Both now wait for the loading text to go.

Verified: history 19/19, shell 18/18 against `localhost:3100` (production build of dev `abde726`). Other scripts this run: auth 27/27, invite 17/17, link 34/34, session 71/71 (the #59 Add set edits hold), lift 17/17, offline 46/46, e1rm 11/11, rollups 18/18. `e2e:backup` is known broken and was not run. A failed shell run had stranded one `@example.com` profile; `e2e:prune --yes` cleared it and the next run left none.
