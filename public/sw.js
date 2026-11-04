/*
 * The service worker. Its first job: the athlete app opens with no signal.
 * Its second (F27): a coach's push notifications reach the screen -- see the
 * bottom of the file. Push touches no cache, so the caching below is exactly
 * what it was, and the version still comes from the registration URL: a
 * deploy that changes this file is a new worker with new caches, no bump.
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

/**
 * Every hashed asset a page references: chunks, CSS, fonts. A URL ends at a
 * quote, whitespace, a backslash (the escaped quotes of the inline RSC payload)
 * or an angle bracket. Parentheses are allowed in pairs: webpack names
 * route-group chunks `chunks/app/(athlete)/layout-<hash>.js`, and stopping at
 * the `)` asks for `/app/(athlete`, which 404s and fails the whole install. An
 * unpaired `)` still ends it, so a CSS `url(/_next/static/...)` stays clean.
 */
const ASSET = /\/_next\/static\/(?:[^"'\s\\()<>]|\([^"'\s\\()<>]*\))+/g;

/** The asset URLs in a page's HTML, as the browser would request them. */
function assetsIn(html) {
  const assets = new Set();
  for (const match of html.matchAll(ASSET)) assets.add(match[0].replace(/&amp;/g, "&"));
  return assets;
}

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
          for (const asset of assetsIn(html)) assets.add(asset);
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

/*
 * Push (F27). A coach hears that an athlete put up a clip or replied.
 *
 * The payload is lib/push/message.ts `PushMessage`. Collapsing happens here:
 * a message names a tag (one per athlete per kind) and a key (the clip or
 * reply it is about), and the notification already showing under that tag
 * carries the keys it stands for. A new key adds to the count and buzzes; a
 * key already in it (the same clip reported twice) replaces it silently.
 *
 * Every push shows a notification, malformed or not. Safari revokes the
 * subscription of a site whose pushes do not, and Chrome shows a generic one
 * of its own.
 */

/** Distinct keys one notification remembers. More than this is "lots". */
const PUSH_KEYS_MAX = 50;
const PUSH_ICON = "/icon-192.png";
const PUSH_FALLBACK = {
  v: 1,
  kind: "test",
  tag: "snb",
  key: "",
  who: "Sticks N Boulders",
  title: "Sticks N Boulders",
  body: "Something needs you.",
  url: "/",
  groupUrl: "/",
};

/** A same-origin absolute path, or "/" -- never a scheme or another host. */
function appPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "/";
}

/** The push's message, or the fallback when it is not one. */
function readPushMessage(data) {
  let raw = null;
  try {
    raw = data ? data.json() : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object" || raw.v !== 1 || typeof raw.tag !== "string" || !raw.tag) return PUSH_FALLBACK;
  const text = (v, fallback) => (typeof v === "string" && v ? v : fallback);
  return {
    v: 1,
    kind: raw.kind === "clip" || raw.kind === "reply" ? raw.kind : "test",
    tag: raw.tag,
    key: text(raw.key, ""),
    who: text(raw.who, "Your athlete"),
    title: text(raw.title, PUSH_FALLBACK.title),
    body: text(raw.body, ""),
    url: appPath(raw.url),
    groupUrl: appPath(raw.groupUrl || raw.url),
  };
}

/** Mirrors lib/push/message.ts collapsedTitle; sw-push.test.ts holds them together. */
function collapsedTitle(kind, who, count) {
  if (count <= 1 || kind === "test") return "";
  return kind === "clip" ? `${who} uploaded ${count} clips` : `${who} replied ${count} times`;
}

/**
 * What to show for `message`, given the notification already showing under
 * its tag (or null). Pure, so it is tested without a browser.
 */
function collapse(existing, message) {
  const before = existing && existing.data && Array.isArray(existing.data.keys) ? existing.data.keys : [];
  const known = message.key !== "" && before.includes(message.key);
  const keys = known || message.key === "" ? before : [...before, message.key].slice(-PUSH_KEYS_MAX);
  const count = Math.max(keys.length, 1);
  const many = count > 1 && message.kind !== "test";
  return {
    title: many ? collapsedTitle(message.kind, message.who, count) : message.title,
    options: {
      body: message.body,
      tag: message.tag,
      // Buzz for something new; replace quietly for a repeat. Ignored where a
      // browser does not support it (Safari), which then always replaces quietly.
      renotify: !known,
      icon: PUSH_ICON,
      badge: PUSH_ICON,
      timestamp: Date.now(),
      data: { url: many ? message.groupUrl : message.url, keys, kind: message.kind },
    },
  };
}

async function showPush(message) {
  const showing = await self.registration.getNotifications({ tag: message.tag }).catch(() => []);
  const { title, options } = collapse(showing[0] || null, message);
  await self.registration.showNotification(title, options);
}

self.addEventListener("push", (event) => {
  event.waitUntil(showPush(readPushMessage(event.data)));
});

/**
 * A tap: focus a window that is already open and take it to the target,
 * else open one. A window already ON the target is focused as it is, so a
 * half-typed comment is not thrown away by a reload.
 */
async function openFromNotification(path) {
  const target = new URL(appPath(path), self.location.origin);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const same = windows.filter((client) => new URL(client.url).origin === target.origin);
  const exact = same.find((client) => {
    const url = new URL(client.url);
    return url.pathname + url.search === target.pathname + target.search;
  });
  if (exact) return exact.focus();
  const client = same.find((c) => c.focused) || same[0];
  if (client) {
    try {
      const focused = await client.focus();
      // navigate() works on a window this worker controls; an uncontrolled
      // one throws, and a new window is the honest fallback.
      return await (focused || client).navigate(target.href);
    } catch {
      /* fall through */
    }
  }
  return self.clients.openWindow(target.href);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openFromNotification(data.url));
});
