import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * One identifier per deploy, shared by the service worker and Next's own skew
 * protection.
 *
 * The service worker names its caches after it, so a new deploy installs a new
 * worker and throws the old caches away. `deploymentId` makes a client that is
 * still running the old build hard-reload on its next navigation instead of
 * mixing old JavaScript with new pages -- the case that matters for a
 * home-screen app, which can sit resumed in the background for days without
 * ever loading a page from scratch.
 *
 * `SNB_BUILD_ID` wins when the host sets it. Otherwise the commit, which is
 * deterministic across the several processes a build runs in (a timestamp is
 * not). With neither, the worker still works; it just never cleans up.
 */
function buildId(): string | undefined {
  if (process.env.SNB_BUILD_ID) return process.env.SNB_BUILD_ID;
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || undefined;
  } catch {
    return undefined;
  }
}

const BUILD_ID = buildId();

const nextConfig: NextConfig = {
  deploymentId: BUILD_ID,
  env: {
    NEXT_PUBLIC_SNB_BUILD_ID: BUILD_ID ?? "unversioned",
  },
  async headers() {
    return [
      {
        // The worker is the one file that must never be served stale: a cached
        // copy is how a deploy strands people on old code.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
