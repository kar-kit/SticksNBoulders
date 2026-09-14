/**
 * Measures the load budget from Order 4: interactive under 2.5s on 4G.
 *
 *   npm run build && npm run start   # in one terminal, on port 3100
 *   npm run perf:check
 *
 * Slowness was Ruairi's first and loudest complaint about RTS, so this is a
 * number the build has to keep hitting rather than a one-off check. Measured
 * against a production build with a cold cache and Chrome's 4G throttling --
 * a dev build says nothing useful here.
 */
import { chromium } from "playwright";

const BASE = process.env.PERF_BASE_URL ?? "http://localhost:3100";
const BUDGET_MS = 2500;

/** Chrome DevTools' own presets, so the numbers mean what people expect. */
const NETWORKS = {
  "Fast 4G": { downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8, latency: 170 },
  "Slow 4G": { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 300 },
} as const;

const ROUTES = ["/sign-in", "/today"];

interface Timing {
  firstContentfulPaint: number;
  domInteractive: number;
  loadEventEnd: number;
  transferredKb: number;
}

async function measure(route: string, network: (typeof NETWORKS)[keyof typeof NETWORKS]): Promise<Timing> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
  const page = await context.newPage();

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...network });
  // A cold cache is the first visit, which is the one that decides whether
  // someone keeps the app.
  await cdp.send("Network.clearBrowserCache");

  let transferred = 0;
  page.on("response", (r) => {
    const length = Number(r.headers()["content-length"] ?? 0);
    if (Number.isFinite(length)) transferred += length;
  });

  await page.goto(`${BASE}${route}`, { waitUntil: "load", timeout: 60_000 });
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      firstContentfulPaint: fcp ? fcp.startTime : Number.NaN,
      domInteractive: nav.domInteractive,
      loadEventEnd: nav.loadEventEnd,
    };
  });

  await browser.close();
  return { ...timing, transferredKb: Math.round(transferred / 1024) };
}

let failed = false;
for (const [name, network] of Object.entries(NETWORKS)) {
  console.log(`\n${name}`);
  for (const route of ROUTES) {
    const t = await measure(route, network);
    const over = t.domInteractive > BUDGET_MS;
    if (over && name === "Fast 4G") failed = true;
    console.log(
      `  ${route.padEnd(10)} FCP ${Math.round(t.firstContentfulPaint)}ms  ` +
        `interactive ${Math.round(t.domInteractive)}ms  load ${Math.round(t.loadEventEnd)}ms  ` +
        `${t.transferredKb}KB  ${over ? "OVER BUDGET" : "ok"}`,
    );
  }
}

console.log(
  failed
    ? `\nOver the ${BUDGET_MS}ms budget on Fast 4G. Slowness is the complaint this product exists to answer.`
    : `\nWithin the ${BUDGET_MS}ms interactive budget on Fast 4G.`,
);
process.exitCode = failed ? 1 : 0;
