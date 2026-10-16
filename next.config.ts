import type { NextConfig } from "next";
import { execSync } from "node:child_process";

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
 * Vercel's `NEXT_DEPLOYMENT_ID` wins when there is one. Then `SNB_BUILD_ID`,
 * when the host sets it. Then Vercel's commit sha, which a
 * Vercel build always has (its build container does not promise a .git
 * directory). Otherwise the commit from git, which is deterministic across the
 * several processes a build runs in (a timestamp is not). With none of them,
 * the worker still works; it just never cleans up.
 */
function buildId(): string | undefined {
  // Vercel hands every build its own deployment id and makes Next fail the
  // build ("NEXT_DEPLOYMENT_ID ... does not match the provided deploymentId")
  // if the config names a different one, so on Vercel this one has to win,
  // even over SNB_BUILD_ID. It is also unique per deployment, which suits the
  // service worker's cache name better than a commit would.
  if (process.env.NEXT_DEPLOYMENT_ID) return process.env.NEXT_DEPLOYMENT_ID;
  if (process.env.SNB_BUILD_ID) return process.env.SNB_BUILD_ID;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12);
  try {
    return (
      execSync("git rev-parse --short=12 HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim() || undefined
    );
  } catch {
    return undefined;
  }
}

const BUILD_ID = buildId();

const nextConfig: NextConfig = {
  // The phone on the LAN that loads the dev server. It was added as a second,
  // stray `module.exports = {...}` beside `export default`, which replaced this
  // whole object and silently dropped the build id and the /sw.js headers
  // below from every production build. It belongs in here.
  allowedDevOrigins: ["192.168.1.189"],
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
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
