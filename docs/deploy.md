# Deploying to Vercel

The app is a plain Next.js project: Vercel needs no build settings beyond the ones below. Everything stateful stays on the Appwrite instance (rows, files, auth, the `validate-row` Function). Vercel runs only the Next.js server: pages and the `/api/*` routes.

Branches: `dev` is where work lands. `prod` is the deploy branch (the GitHub default). `vercel.json` has an `ignoreCommand` that skips the build for any other branch, so a branch push or a PR never builds, and so never runs against the live instance.

## What was checked

- [Fact] `next build` (Turbopack, the Vercel default) and `next build --webpack` both succeed on Node 24, and the full unit suite passes on Node 24 (2825 tests).
- [Fact] Vercel sets `NEXT_DEPLOYMENT_ID` and Next fails the build if the config names a different deploymentId, so `next.config.ts` takes it first (it is a Vercel build, so it is what the service worker caches are named after too). Outside Vercel, with `VERCEL_GIT_COMMIT_SHA` set, the built config carries `deploymentId` and the `/sw.js` no-cache header. (On `dev`, between 16 Oct commit `5dc133d` and this change, a stray `module.exports` in `next.config.ts` dropped both. `lib/build/next-config.test.ts` now guards it.)
- [Fact] The clip route (`/api/clip/[fileId]`) streams the body unbuffered and forwards `Range`, so it works as a Node function. `vercel.json` gives it `maxDuration: 300`.
- [Fact] Chunked uploads go from the browser to Appwrite, not through a Vercel function, so Vercel's request-body limit does not apply to video.
- [Unverified] Not deployed to Vercel yet. Nothing here has run on a real Vercel build.
- [Unverified] That Vercel supports Node 26, which `.nvmrc` pins for CI and local. `engines` says `24.x`, which Vercel documents.

## The project

1. Create the project from the GitHub repo `kar-kit/SticksNBoulders`, under a personal Vercel account.
2. Settings, Git: **Production Branch = `prod`**.
3. Settings, General: Node.js version `24.x` (or leave it to `engines`). Framework Next.js, default build and install commands, no root directory.
4. Region: `vercel.json` sets `lhr1` (London), to be near the Appwrite host. [Inference] This is a guess at where that host is relative to Vercel; change it if the latency says otherwise.
5. Add the environment variables below, **for Production only**. Leaving Preview empty is deliberate: a Preview build has no config and fails loudly, rather than running against the live data.
6. Settings, Deployment Protection: leave protection on for Preview; the Production domain is public by design (coaches and athletes sign in there).

## Environment variables

Set them before the first build. The three `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, so changing one means a redeploy.

| Name | Public | Needed for |
|---|---|---|
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | yes | Appwrite API URL, e.g. `https://appwrite.jp-homelab.work/v1` |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | yes | The Appwrite project |
| `NEXT_PUBLIC_APPWRITE_DATABASE_ID` | yes | The database |
| `APPWRITE_API_KEY` | **secret** | Server routes only (`/api/*`). Never `NEXT_PUBLIC_`. |
| `VIDEO_TICKET_SECRET` | **secret** | Signs clip playback URLs. The server refuses to start without it. Generate with `openssl rand -base64 48`; use a new value, not the local one. |
| `NEXT_PUBLIC_APPWRITE_APPLE_ENABLED` | yes | Leave unset until an Apple Developer account exists. |

Do not set `SNB_BACKUP_DIR` or `SNB_BACKUP_OFFSITE` on Vercel: they belong to the backup scripts, which run on the machine that holds the backups.

`APPWRITE_API_KEY`: [Inference] give the Vercel key only the scopes the `/api/*` routes use, not the setup script's. It is a separate key from the one in `.env.local`, so either can be revoked alone.

## On the Appwrite side (console, once the domain exists)

1. **Add the domain as a Web platform** in the project's Overview, for the production domain (and any custom domain). Without it the browser SDK is refused by CORS.
2. **OAuth:** Google (and Apple, when enabled) need the Appwrite callback unchanged, but the success and failure redirect URLs the app sends are on the new domain; confirm the provider's console allows it. [Unverified] Not tried on a non-local domain.
3. The endpoint must be reachable from the public internet. [Fact] `https://appwrite.jp-homelab.work/v1/health` answers (401 without a key) from the build machine. [Unverified] from Vercel's network.
4. Sign-up is open on the instance (known, tracked in `SticksNBoulders Build Checkpoint V1.md`); the deployed app inherits that.

## First deploy checklist

1. Merge this to `dev`, then fast-forward `prod`: `git push origin dev:prod`.
2. Vercel builds `prod` automatically. Check the deployment log for the build id (the commit's first 12 characters).
3. Open the domain: sign in, open the coach's athlete page, play one clip (it goes through `/api/clip`, the one route that streams).
4. In DevTools, Application, Service Workers: `/sw.js` is installed, and its response has `Cache-Control: no-cache`.
5. On a phone, add to Home Screen and log one set offline.
6. Run `npm run appwrite:audit` from the repo. It tests Appwrite, not Vercel, so it should be unchanged, but confirms nothing about the move broke permissions.

## Not done here

- No Vercel project exists yet and no domain is chosen.
- Appwrite Cloud migration (January 2027): when it happens, change the three `NEXT_PUBLIC_*` values and redeploy.
- Backups still run from the home machine and are not copied off it (Order 5 follow-up).
