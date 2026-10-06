/*
 * The service worker. Its one job: the athlete app opens with no signal.
 *
 * The logger was already durable -- sets go to IndexedDB first (docs/offline.md)
 * -- but a queue is no use if the page holding it cannot load in a basement.
 * This caches the app shell, and nothing else. See docs/pwa.md for the why.
 *
 * What it will never cache:
 *   - anything cross-origin. Appwrite is cross-origin, so no session, no row,
 *     no clip and no permission decision ever passes through here.
 *   - /api/*. Same-origin, but authenticated with a per-user JWT.
 *   - a page the server marked private or no-store. Every page that can differ
 *     between two people is dynamic, and Next marks dynamic pages no-store. The
 *     static pages are the same bytes for everyone; the data arrives later,
 *     straight from Appwrite, under the signed-in user's own session.
 *   - query strings. Pages are stored by path, so an OAuth or reset secret in a
 *     URL never becomes a cache key.
 *
 * Updates: the version comes from the registration URL (?v=<build id>), so every
 * deploy is a new worker with new caches, and the old ones are deleted when it
 * activates. Pages are network-first, so being online always means current
 * code; the cache is only what is served when the network is not there.
 *
 * Plain JavaScript on purpose: no build step, and it is short enough to review
 * in one sitting. Keep it that way.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "unversioned";
const SHELL_CACHE = `snb-shell-${VERSION}`;
const STATIC_CACHE = `snb-static-${VERSION}`;
const OWN_CACHE = /^snb-(shell|static)-/;

/**
 * Pages that must open with no signal. The athlete app, sign-in (so a signed-out
 * phone still gets a screen rather than the browser's dinosaur) and the page
 * shown for anything else.
 */
const SHELL_PAGES = ["/", "/today", "/log", "/history", "/me", "/bodyweight", "/sign-in", "/offline"];
// Icons are not here: the OS copies them at install, and a page opened offline
// does not need them. 400KB of PNGs is not worth a 4G connection.
const SHELL_FILES = ["/manifest.webmanifest"];
const OFFLINE_PAGE = "/offline";

/**
 * How long a page waits for the network before the cached copy is served.
 * Gym wifi that associates and routes nowhere never fails, it just hangs, and
 * the budget for being interactive is 2.5s -- 2s of waiting plus a cached page
 * that is interactive in ~300ms fits inside it. Serving the cached copy to a
 * connection that is merely slow is harmless: it is the same build.
 */
const NETWORK_TIMEOUT_MS = 2000;

/** Every hashed asset a page references: chunks, CSS, fonts. */
const ASSET = /\/_next\/static\/[^"'\s\\)<>]+/g;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      const assets = new Set();
      // All or nothing. Half a shell is worse than the previous whole one,
      // and a failed install leaves the previous worker serving.
      await Promise.all(
        SHELL_PAGES.map(async (path) => {
          const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
          if (!response.ok || !isShareable(response)) throw new Error(`shell page ${path}: ${response.status}`);
          const html = await response.clone().text();
          for (const match of html.matchAll(ASSET)) assets.add(match[0]);
          await shell.put(path, response);
        }),
      );
      await shell.addAll(SHELL_FILES);
      const statics = await caches.open(STATIC_CACHE);
      await statics.addAll([...assets]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (OWN_CACHE.test(name) && !keep.has(name)) await caches.delete(name);
      }
      // The worker boots in parallel with the page request instead of in front
      // of it, which is most of what a network-first worker costs online.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(page(event, url));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(immutable(request));
    return;
  }
  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(networkThenCache(request, url.pathname));
  }
  // Everything else -- RSC payloads, images, the lot -- goes to the network
  // untouched. A failed RSC fetch makes Next fall back to a full navigation,
  // which lands in page() below.
});

/** Network first, cached copy after a timeout or a failure, then /offline. */
async function page(event, url) {
  const key = url.pathname;
  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (response.ok && !response.redirected && isShareable(response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(key, copy)));
    }
    return response;
  })();
  // Keep the refresh running even when the cached copy wins the race.
  event.waitUntil(network.catch(() => undefined));

  const cached = () => caches.match(key, { ignoreSearch: true });
  try {
    const winner = await Promise.race([network, timeout(NETWORK_TIMEOUT_MS)]);
    if (winner) return winner;
    const stale = await cached();
    return stale || (await network);
  } catch {
    return (await cached()) || (await caches.match(OFFLINE_PAGE)) || Response.error();
  }
}

/** Hashed filenames never change content, so the cache is always right. */
async function immutable(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

async function networkThenCache(request, key) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(key)) || Response.error();
  }
}

/**
 * Whether a page is the same for everyone. Next marks every dynamic render
 * no-store; a page that might carry one person's data is never kept.
 */
function isShareable(response) {
  const control = (response.headers.get("Cache-Control") || "").toLowerCase();
  return response.type === "basic" && !control.includes("no-store") && !control.includes("private");
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}
