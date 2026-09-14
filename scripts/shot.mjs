/**
 * Screenshot a route at the two baselines the product is designed against.
 * Every UI feature PR needs one, so this exists rather than being retyped.
 *
 *   node scripts/shot.mjs /design --width 1440 --out .shots/design.png
 *   node scripts/shot.mjs /log --mobile
 *   node scripts/shot.mjs /design --selector "[data-shot=set-row]"
 *   node scripts/shot.mjs /design --fill "[role=combobox]::rdl"
 *
 * --fill types into a field before capturing, so a component that only shows
 * its interesting state once someone has typed -- a typeahead, a number pad --
 * can be screenshotted in that state rather than empty. Repeatable.
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
// A 401 from account.get() on a signed-out page is the app working correctly,
// and the browser logs every non-2xx as a console error regardless. Only real
// script failures and non-auth resource errors are worth failing a shot over.
const EXPECTED = /Failed to load resource.*status of (401|403)/;
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (!EXPECTED.test(text)) problems.push(text);
});
page.on("pageerror", (e) => problems.push(String(e)));

const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
if (!response?.ok()) {
  throw new Error(`${base}${route} returned ${response?.status()}`);
}
// Webfonts shifting after capture makes a screenshot lie about the type scale.
await page.evaluate(() => document.fonts.ready);

await mkdir(dirname(out), { recursive: true });

// Typing before capture, so an interactive state can be photographed.
const fills = args.reduce((acc, arg, i) => {
  if (arg === "--fill" && args[i + 1]) acc.push(args[i + 1]);
  return acc;
}, []);
for (const fill of fills) {
  // Separated by "::" rather than "=", which appears inside attribute
  // selectors like [role=combobox] and would split in the wrong place.
  const at = fill.indexOf("::");
  if (at === -1) throw new Error(`--fill needs "<selector>::<text>", got "${fill}"`);
  const field = page.locator(fill.slice(0, at)).first();
  await field.waitFor({ state: "visible" });
  await field.click();
  await field.fill(fill.slice(at + 2));
}

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
