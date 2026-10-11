/**
 * What the service worker would precache, computed from a build on disk.
 *
 * public/sw.js stays plain JavaScript with no build step and no exports, so
 * this runs the real file in a bare VM context and reads its own `SHELL_PAGES`
 * and `assetsIn` back out. The unit test and `npm run check:sw` both go
 * through here, so neither can drift from what the worker actually does.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

export interface ServiceWorkerScript {
  shellPages: readonly string[];
  assetsIn: (html: string) => Set<string>;
}

const SW_PATH = path.join(__dirname, "..", "public", "sw.js");

export function loadServiceWorker(file = SW_PATH): ServiceWorkerScript {
  // Only what the top level touches. The handlers are registered, never run.
  const context = vm.createContext({
    URL,
    self: { location: { href: "https://snb.test/sw.js?v=check" }, addEventListener: () => {} },
  });
  vm.runInContext(readFileSync(file, "utf8"), context, { filename: file });
  // A later script in the same context sees the first one's top-level consts.
  const { shellPages, assetsIn } = vm.runInContext("({ shellPages: SHELL_PAGES, assetsIn })", context);
  return { shellPages, assetsIn };
}

/** Where Next writes a prerendered page: `/` is index.html, `/sign-in` is sign-in.html. */
export function prerenderedHtml(distDir: string, page: string): string {
  return path.join(distDir, "server", "app", `${page === "/" ? "index" : page.slice(1)}.html`);
}

/** `/_next/static/x.js?dpl=abc` to `<distDir>/static/x.js`. */
export function staticFile(distDir: string, url: string): string {
  const pathname = decodeURIComponent(url.split(/[?#]/)[0]);
  return path.join(distDir, "static", pathname.slice("/_next/static/".length));
}

export interface PrecacheReport {
  /** Shell pages with no prerendered HTML. The worker's install would fail on them too. */
  missingPages: string[];
  /** Asset URL to the page that referenced it, for every asset with no file behind it. */
  missingAssets: Map<string, string>;
  assetCount: number;
}

export function checkPrecache(distDir: string, sw: ServiceWorkerScript = loadServiceWorker()): PrecacheReport {
  const report: PrecacheReport = { missingPages: [], missingAssets: new Map(), assetCount: 0 };
  const seen = new Set<string>();
  for (const page of sw.shellPages) {
    const file = prerenderedHtml(distDir, page);
    if (!existsSync(file)) {
      report.missingPages.push(page);
      continue;
    }
    for (const asset of sw.assetsIn(readFileSync(file, "utf8"))) {
      if (seen.has(asset)) continue;
      seen.add(asset);
      if (!existsSync(staticFile(distDir, asset))) report.missingAssets.set(asset, page);
    }
  }
  report.assetCount = seen.size;
  return report;
}
