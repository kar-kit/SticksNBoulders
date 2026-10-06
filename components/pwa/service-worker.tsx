"use client";

import { useEffect } from "react";

const BUILD_ID = process.env.NEXT_PUBLIC_SNB_BUILD_ID ?? "unversioned";

/** How often a resumed app asks whether a deploy has happened. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Registers public/sw.js, versioned by build.
 *
 * After `load`, never before: the first visit is the one that decides whether
 * someone keeps the app, and the worker's install -- eight pages and their
 * chunks -- must not compete with it for a 4G connection.
 *
 * Production only. A worker in dev caches the thing you are trying to change.
 *
 * A home-screen app is resumed far more often than it is opened, and the
 * browser only checks for a new worker on a navigation. So coming back to the
 * foreground asks too, at most hourly. The new worker takes over quietly; the
 * page is never reloaded underneath someone mid-set. Their next navigation gets
 * the new code (see deploymentId in next.config.ts).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();

    const register = () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { scope: "/", updateViaCache: "none" })
        .then((r) => {
          registration = r;
        })
        // No worker means no offline cold start, which is exactly how the app
        // behaved before it had one. Not worth a word to the athlete.
        .catch(() => {});
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !registration) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
