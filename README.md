# SticksNBoulders

A private, installable PWA for a small group of friends to log strength training and compete on bodyweight-fair leaderboards (DOTS score), with an optional coach layer and a photo-verified weekly weigh-in.

## Stack

- **Frontend**: Next.js (App Router, TypeScript), Tailwind CSS v4.
- **Backend**: Appwrite (Databases/TablesDB, Auth, Teams, Storage, Functions) at `appwrite.jp-homelab.work`.
- **Anti-cheat**: an Appwrite Function calls a self-hosted Ollama vision model to verify weekly weigh-in photos.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Backend

The Appwrite schema (database `sticksnboulders`: 9 tables, indexes, the `bodyweight_photos` storage bucket) and all 6 Appwrite Functions under `/functions` are already provisioned on the connected Appwrite project. To redeploy a function after editing its source:

```bash
cd functions/<name>
tar -czf /tmp/<name>.tar.gz --exclude=node_modules .
# then upload /tmp/<name>.tar.gz as a new deployment via the Appwrite console or MCP
```

`functions/weighin-vision-check` needs `OLLAMA_URL` and `OLLAMA_MODEL` environment variables set on the function (already configured against the homelab Ollama instance).

## Tests

```bash
npm test          # run once
npm run test:watch
```

Jest (via `next/jest`) covers the pure logic in `lib/` and `components/`, plus the small business-logic modules extracted out of the Appwrite Functions (`functions/*/src/{dots,code-generator,vision-evaluator}.js` — the parts of each function worth unit-testing, as opposed to `main.js`'s network/IO glue). Run the suite after touching any of these before assuming a change is safe.

## Assets

Brand assets (favicon, PWA icons, maskable icon, transparent mark cutout) live in `/assets`, sampled and generated directly from `SNB.png`. The subset actually served by the app is mirrored into `/public` and `/app` per Next's icon conventions.

## Known gaps

- Google/Apple OAuth requires real client credentials from your own Google Cloud Console / Apple Developer accounts, configured in the Appwrite console (Auth → Google/Apple). Email/password sign-in works today without any extra setup.
- The Appwrite project's Web platform allowlist (CORS) needs to be registered in the Appwrite console for each hostname you serve the app from (this couldn't be done via the API-key-scoped MCP connection used to provision everything else).
