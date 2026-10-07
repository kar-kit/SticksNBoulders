/**
 * Checks the install surface and the service worker against a production build.
 *
 *   npm run build && npm run start    # port 3100
 *   npm run e2e:pwa
 *
 * localhost is a secure context, so Chromium runs the worker exactly as it would
 * over HTTPS. What it cannot show -- the real install prompt, iOS launch
 * behaviour, a phone's own offline mode -- is listed in docs/pwa.md.
 *
 * Unlike e2e:offline, which cuts only Appwrite, this takes the whole browser
 * offline. That is the other half of the gym-basement claim: the phone was
 * locked in a bag, the app was killed, and it has to open from nothing.
 *
 * Creates one throwaway athlete and removes them and their work.
 */
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { z } from "zod";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { presetMode } from "./e2e-mode";
import { circleTeamId } from "../appwrite/documents/circle";
import { SPLASH_SCREENS, splashPath } from "../lib/pwa/splash";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const BACKGROUND = "#1d1c22";
const SHELL_PAGES = ["/", "/today", "/log", "/history", "/me", "/bodyweight", "/sign-in", "/offline"];

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `  (${JSON.stringify(detail)})` : ""}`);
};

const imageSize = async (path: string) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) return null;
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  return { width: meta.width, height: meta.height, type: res.headers.get("content-type") };
};

// --- 1. The manifest ----------------------------------------------------
console.log("\nThe manifest");
const Manifest = z.object({
  id: z.string(),
  name: z.string().min(1),
  short_name: z.string().min(1).max(12),
  start_url: z.string(),
  scope: z.string(),
  display: z.literal("standalone"),
  background_color: z.literal(BACKGROUND),
  theme_color: z.literal(BACKGROUND),
  icons: z.array(z.object({ src: z.string(), sizes: z.string(), type: z.string(), purpose: z.string() })),
});
const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
check("is served as application/manifest+json", (manifestRes.headers.get("content-type") ?? "").includes("manifest+json"));
const parsed = Manifest.safeParse(await manifestRes.json());
check("has every field an install needs, in the app's own colours", parsed.success, parsed.error?.issues);
const manifest = parsed.data!;
check("start_url sits inside scope", manifest.start_url.startsWith(manifest.scope));
for (const need of [
  { size: "192x192", purpose: "any" },
  { size: "512x512", purpose: "any" },
  { size: "512x512", purpose: "maskable" },
]) {
  check(
    `declares a ${need.size} ${need.purpose} icon`,
    manifest.icons.some((i) => i.sizes === need.size && i.purpose.split(" ").includes(need.purpose)),
  );
}
for (const icon of manifest.icons) {
  const size = await imageSize(icon.src);
  const [w, h] = icon.sizes.split("x").map(Number);
  check(`${icon.src} is really ${icon.sizes}`, size?.width === w && size?.height === h, size);
}

// --- 2. The head, for iOS -----------------------------------------------
console.log("\nThe page head");
const html = await (await fetch(`${BASE}/today`)).text();
const has = (re: RegExp) => re.test(html);
check("links the manifest", has(/<link rel="manifest" href="\/manifest.webmanifest"/));
check("has an apple-touch-icon", has(/<link rel="apple-touch-icon"[^>]*sizes="180x180"/));
check("is a standalone web app on iOS", has(/<meta name="mobile-web-app-capable" content="yes"/));
check("paints the status bar the app colour", has(new RegExp(`<meta name="theme-color" content="${BACKGROUND}"`)));
check("paints the first frame dark before any CSS", has(new RegExp(`<html[^>]*style="background-color:${BACKGROUND}`)));
const apple = await imageSize("/apple-icon.png");
check("the apple-touch-icon is 180x180", apple?.width === 180 && apple?.height === 180, apple);
for (const screen of SPLASH_SCREENS) {
  const path = splashPath(screen);
  const size = await imageSize(path);
  check(
    `launch image for ${screen.devices} is linked and ${screen.width * screen.ratio}x${screen.height * screen.ratio}`,
    html.includes(`href="${path}"`) && size?.width === screen.width * screen.ratio && size?.height === screen.height * screen.ratio,
    size,
  );
}
const sw = await fetch(`${BASE}/sw.js`);
check("the worker is never served from an HTTP cache", (sw.headers.get("cache-control") ?? "").includes("no-store"));

// --- 3. The worker ------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
const page = await ctx.newPage();

const cacheReport = (p: Page) =>
  p.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      out[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
    }
    return out;
  });

const waitForWorker = async (p: Page) => {
  await p.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30000 });
  return p.evaluate(() => navigator.serviceWorker.controller!.scriptURL);
};

console.log("\nThe service worker, first visit");
await page.goto(`${BASE}/sign-in`);
const scriptURL = await waitForWorker(page).catch(() => "");
check("registers and takes control without a reload", scriptURL.includes("/sw.js?v="));
const version = new URL(scriptURL || `${BASE}/sw.js?v=`).searchParams.get("v") ?? "";
check("is versioned by the build", version.length > 0 && version !== "unversioned", version);
const caches1 = await cacheReport(page);
const shell = caches1[`snb-shell-${version}`] ?? [];
const statics = caches1[`snb-static-${version}`] ?? [];
check(
  "has the whole athlete shell cached",
  SHELL_PAGES.every((p) => shell.includes(`${BASE}${p}`)),
  SHELL_PAGES.filter((p) => !shell.includes(`${BASE}${p}`)),
);
check("and the chunks, CSS and fonts it needs", statics.some((u) => u.endsWith(".css") || u.includes(".css?")) && statics.some((u) => u.includes(".woff2")));

// What installing the worker costs, after the first page has loaded.
const precacheKb = await page.evaluate(async () => {
  let bytes = 0;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) bytes += (await (await cache.match(req))!.arrayBuffer()).byteLength;
  }
  return Math.round(bytes / 1024);
});
console.log(`  precache: ${shell.length} shell entries, ${statics.length} assets, ${precacheKb}KB uncompressed`);

const sameOriginOnly = (report: Record<string, string[]>) =>
  Object.values(report)
    .flat()
    .filter((u) => !u.startsWith(BASE) || u.includes("/api/"));

console.log("\nWith no network at all");
await ctx.setOffline(true);
for (const path of ["/sign-in", "/today", "/log"]) {
  // A fresh tab each time: signed out, /today redirects itself to /sign-in, and
  // that client-side hop would otherwise collide with the next goto.
  const tab = await ctx.newPage();
  const res = await tab.goto(`${BASE}${path}`).catch(() => null);
  check(`${path} opens from the phone`, res?.status() === 200 && (res?.fromServiceWorker() ?? false));
  await tab.close();
}
const unknown = await page.goto(`${BASE}/history/not-cached-${Date.now()}`).catch(() => null);
check(
  "a screen it has no copy of gets the calm offline page, not the browser's error",
  unknown?.status() === 200 &&
    (await page.getByRole("heading", { name: "No signal" }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false)),
);
await ctx.setOffline(false);

// --- 4. The logger, from a cold start with nothing ----------------------
console.log("\nA signed-in athlete, cold start, no signal");
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const adminDb = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const db = config.databaseId;
const stamp = Date.now();
const athlete = await users.create({ userId: ID.unique(), email: `pwa-${stamp}@example.com`, password: "Probe-pass-123!", name: "Joey Pang" });
await presetMode(users, athlete, "athlete");
const rowsOf = async (table: "sets" | "sessions", athleteId: string) =>
  (await adminDb.listRows({ databaseId: db, tableId: table, queries: [Query.equal("athlete_id", athleteId), Query.limit(50)], ttl: 0 })).rows;

const pad = async (p: Page, digits: string) => {
  for (const key of digits) await p.getByRole("button", { name: key, exact: true }).click();
};

try {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(athlete.email);
  await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
  check("signed in", page.url().endsWith("/today"));
  // The gym door: the library and the user are remembered while there is signal.
  await page.goto(`${BASE}/log`);
  await page.waitForTimeout(2000);

  await ctx.setOffline(true);
  // A fresh tab rather than a reload: nothing in memory, only what is on disk.
  await page.close();
  const cold = await ctx.newPage();
  const res = await cold.goto(`${BASE}/log`).catch(() => null);
  check("the logger opens with the network off", res?.status() === 200);
  await cold.getByRole("button", { name: "Start a session" }).click();
  await cold.getByRole("button", { name: "Finish session" }).waitFor({ timeout: 15000 }).catch(() => {});
  check("a session starts", await cold.getByRole("button", { name: "Finish session" }).isVisible());
  await cold.getByRole("combobox").fill("squat");
  await cold.getByRole("option", { name: "Squat", exact: true }).first().click();
  await cold.getByRole("group", { name: "Set 1" }).waitFor({ timeout: 10000 }).catch(() => {});
  await cold.getByRole("button", { name: /weight in kilograms/ }).click();
  await pad(cold, "100");
  await cold.getByRole("button", { name: "Reps", exact: true }).click();
  await pad(cold, "5");
  await cold.getByRole("button", { name: "Log Set 1" }).click();
  await cold.waitForTimeout(800);
  check("a set logs and shows queued, not failed", (await cold.getByLabel("Queued, will sync").count()) >= 1);

  await cold.reload().catch(() => {});
  await cold.getByRole("button", { name: "Finish session" }).waitFor({ timeout: 15000 }).catch(() => {});
  check("and survives the app being reopened offline", await cold.getByRole("group", { name: "Set 1" }).first().isVisible().catch(() => false));
  check("nothing reached Appwrite", (await rowsOf("sets", athlete.$id)).length === 0);

  await ctx.setOffline(false);
  const deadline = Date.now() + 30000;
  while ((await rowsOf("sets", athlete.$id)).length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  const sets = await rowsOf("sets", athlete.$id);
  check("the set lands exactly once when the signal returns", sets.length === 1 && sets[0]?.load_kg === 100, sets.length);

  const after = await cacheReport(cold);
  const leaks = sameOriginOnly(after);
  check("after a signed-in session, no API or Appwrite response is in any cache", leaks.length === 0, leaks);
  check(
    "and no cached page carries a query string",
    Object.values(after).flat().filter((u) => !u.includes("/_next/static/")).every((u) => !new URL(u).search),
  );

  // --- 5. A deploy ------------------------------------------------------
  console.log("\nA new deploy");
  const next = "e2e-next-build";
  await cold.evaluate((v) => navigator.serviceWorker.register(`/sw.js?v=${v}`, { scope: "/", updateViaCache: "none" }), next);
  // The controller switches when the new worker starts activating; the old
  // caches go during activation. So wait for activated, not for the switch.
  await cold
    .waitForFunction(
      (v) => {
        const c = navigator.serviceWorker.controller;
        return c?.scriptURL.endsWith(`v=${v}`) && c.state === "activated";
      },
      next,
      { timeout: 30000 },
    )
    .catch(() => {});
  const names = Object.keys(await cacheReport(cold));
  check("the new worker takes over without a reload", (await cold.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).endsWith(`v=${next}`));
  check("and the old build's caches are gone", !names.some((n) => n.endsWith(version)) && names.includes(`snb-shell-${next}`), names);
  check("the page it took over is still running, not reloaded", await cold.getByRole("group", { name: "Set 1" }).first().isVisible().catch(() => false));
  // Put the real build's worker back for anything that runs after.
  await cold.evaluate((v) => navigator.serviceWorker.register(`/sw.js?v=${v}`, { scope: "/", updateViaCache: "none" }), version);

  // --- 6. What a repeat visit costs ------------------------------------
  console.log("\nLoad times with the worker in place (Slow 4G)");
  const timed = await ctx.newPage();
  const cdp = await ctx.newCDPSession(timed);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 300,
  });
  await timed.goto(`${BASE}/today`, { waitUntil: "load" });
  const warm = await timed.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domInteractive);
  console.log(`  repeat visit /today  interactive ${Math.round(warm)}ms`);
  await ctx.setOffline(true);
  await timed.goto(`${BASE}/log`, { waitUntil: "load" });
  const offline = await timed.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domInteractive);
  console.log(`  offline cold open /log  interactive ${Math.round(offline)}ms`);
  check("offline open is inside the 2.5s budget", offline < 2500, Math.round(offline));
  await ctx.setOffline(false);
} finally {
  await browser.close();
  for (const row of await rowsOf("sets", athlete.$id)) await adminDb.deleteRow({ databaseId: db, tableId: "sets", rowId: row.$id });
  for (const row of await rowsOf("sessions", athlete.$id)) await adminDb.deleteRow({ databaseId: db, tableId: "sessions", rowId: row.$id });
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  await users.delete({ userId: athlete.$id });
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Athlete removed.` : `\n${failed} of ${results.length} FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;

