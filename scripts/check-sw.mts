/**
 * Build gate: every asset the service worker would precache exists in the build.
 *
 *   npm run build     # or: npx next build --webpack
 *   npm run check:sw
 *
 * The worker's install is all or nothing, so one URL it extracts wrongly (a
 * route-group chunk cut off at its `)`, say) 404s and leaves the athlete app
 * with no offline shell at all. That fails silently in a browser. This reads
 * the prerendered shell pages from .next/server/app with the worker's own
 * extraction and fails if a page or an asset is missing. No server, no browser.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { checkPrecache } from "./sw-precache";

const distDir = path.resolve(process.argv[2] ?? ".next");
if (!existsSync(path.join(distDir, "server", "app"))) {
  console.error(`No build at ${distDir}. Run \`npm run build\` first.`);
  process.exit(1);
}

const bundler = existsSync(path.join(distDir, "server", "chunks", "ssr")) ? "turbopack" : "webpack";
const { missingPages, missingAssets, assetCount } = checkPrecache(distDir);

for (const page of missingPages) console.error(`  page  ${page}: not prerendered, the worker cannot cache it`);
for (const [asset, page] of missingAssets) console.error(`  asset ${asset} (from ${page}): no such file`);

if (missingPages.length || missingAssets.size) {
  console.error(`check:sw failed (${bundler} build): the service worker install would fail.`);
  process.exit(1);
}
console.log(`check:sw ok (${bundler} build): ${assetCount} assets across the shell pages, all present.`);
