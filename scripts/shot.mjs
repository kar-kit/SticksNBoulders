/**
 * Screenshot a route at the two baselines the product is designed against.
 * Every UI feature PR needs one, so this exists rather than being retyped.
 *
 *   node scripts/shot.mjs /design --width 1440 --out .shots/design.png
 *   node scripts/shot.mjs /log --mobile
 *   node scripts/shot.mjs /design --selector "[data-shot=set-row]"
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const route = args.find((a) => a.startsWith("/")) ?? "/";
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const mobile = args.includes("--mobile");
const width = Number(flag("width", mobile ? 390 : 1440));
const height = Number(flag("height", mobile ? 852 : 900));
const fullPage = !args.includes("--viewport");
const base = flag("base", process.env.SHOT_BASE_URL ?? "http://localhost:3000");
const out = flag("out", `.shots${route === "/" ? "/index" : route}-${width}.png`);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
if (!response?.ok()) {
  throw new Error(`${base}${route} returned ${response?.status()}`);
}
// Webfonts shifting after capture makes a screenshot lie about the type scale.
await page.evaluate(() => document.fonts.ready);

await mkdir(dirname(out), { recursive: true });

// Scoping to one element keeps a PR screenshot about the thing that changed.
const selector = flag("selector", null);
if (selector) {
  const target = page.locator(selector).first();
  await target.waitFor({ state: "visible" });
  await target.screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage });
}
await browser.close();

console.log(`${out}  ${width}x${height}${fullPage ? " full-page" : ""}`);
if (problems.length) {
  console.error(`\n${problems.length} console error(s):`);
  for (const p of problems.slice(0, 10)) console.error(`  ${p}`);
  process.exitCode = 1;
}
