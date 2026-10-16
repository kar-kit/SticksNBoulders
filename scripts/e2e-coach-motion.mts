/**
 * Proves the coach side's motion actually runs, and that it does not under
 * reduced motion. docs/coach-motion.md is the list of what moves and why.
 *
 *   npx next build --webpack && npx next start -p 3205
 *   E2E_BASE_URL=http://localhost:3205 npm run e2e:coach-motion
 *
 * Driven with real mouse and keyboard events at 1440×900. A recorder in the
 * page polls `document.getAnimations()` every frame and notes each animation
 * and transition the first time it appears -- its kind, its name (keyframes
 * or transitioned property), its target and pseudo-element, and its length --
 * so a 90ms press is caught as reliably as a 400ms tint. Each check then asks
 * the recorder whether the motion it expects ran on the element it expects.
 *
 * Then the same interactions again with `reducedMotion: "reduce"`: every
 * animation or transition inside the coach shell must be at most 1ms long
 * (the floor in globals.css makes them 0.01ms), nothing must still be running
 * shortly after, and the dialog and the drawer must leave at once.
 *
 * Run against a build without the motion, every "runs" check fails: that is
 * this script's mutation check.
 *
 * It also holds /api/program in the browser (Playwright routing) to prove an
 * added line is on screen before the server answers, keeps what was typed
 * into it, and rolls back when the add is refused.
 *
 * Writes through the same ops the editor sends, on throwaway users; deletes
 * only what it created.
 */
import { chromium, type Locator, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { bodyweightRowId } from "../appwrite/documents";
import { bodyweightPermissions, profilePermissions } from "../appwrite/documents/policy";
import { addDays, localDay } from "../lib/programming/program";
import { mondayOf } from "../lib/programming/calendar";
import { sampleProgram, writeOutline } from "../lib/programming/sample-program";
import { linkPair, opRunner, sampleExerciseIds } from "./program-fixtures";
import { presetMode } from "./e2e-mode";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3205";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();
const today = localDay();
const PROGRAM_TABLES = ["prescriptions", "program_days", "program_weeks", "program_blocks", "programs"] as const;

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `motion-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const athlete = await presetMode(users, await mkUser("a", "Joey Pang"), "athlete");
const coach = await presetMode(users, await mkUser("c", "Ruairi Deane"), "coach");
const created = { link: "", programId: "", exercises: [] as string[], bodyweight: [] as string[] };

const rowsOf = async (tableId: string, column: string, value: string) =>
  (await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 }))
    .rows as unknown as Array<Record<string, unknown> & { $id: string }>;
const poll = async <T,>(read: () => Promise<T>, done: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    value = await read();
  }
  return value;
};
const appears = (target: Locator, timeout = 20000) =>
  target
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

/**
 * The recorder, as a string: tsx wraps named functions in a helper that does
 * not exist in the page. One entry per animation object, the first frame it
 * is seen. `scope` is whether its element sits inside the coach shell.
 */
const RECORDER = `(() => {
  if (window.__motion) return;
  const seen = new WeakSet();
  const log = [];
  window.__motion = { log };
  const describe = (el) => {
    if (!el || !el.getAttribute) return "";
    const own = el.getAttribute("aria-label") || el.getAttribute("role") || "";
    const near = el.closest("[aria-label]");
    return [
      el.tagName.toLowerCase(),
      own,
      el.getAttribute("data-state") ? "state=" + el.getAttribute("data-state") : "",
      el.getAttribute("data-flash") ? "flash=" + el.getAttribute("data-flash") : "",
      near && near !== el ? "in=" + near.getAttribute("aria-label") : "",
    ].filter(Boolean).join("|");
  };
  const poll = () => {
    for (const a of document.getAnimations()) {
      if (seen.has(a)) continue;
      seen.add(a);
      const effect = a.effect;
      const target = effect && effect.target;
      const timing = effect ? effect.getComputedTiming() : {};
      log.push({
        kind: a.constructor.name,
        name: a.animationName || a.transitionProperty || "",
        pseudo: (effect && effect.pseudoElement) || "",
        target: describe(target),
        coach: Boolean(target && target.closest && target.closest(".coach-scale")),
        duration: Number(timing.duration) || 0,
      });
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
})()`;

type Entry = { kind: string; name: string; pseudo: string; target: string; coach: boolean; duration: number };

const recorder = async (page: Page) => {
  await page.evaluate(RECORDER);
  let from = 0;
  return {
    /** Starts a new window: what happens from here on. */
    mark: async () => {
      from = (await page.evaluate("window.__motion.log.length")) as number;
    },
    /** Everything recorded since the mark, after letting `ms` pass. */
    since: async (ms = 450): Promise<Entry[]> => {
      await page.waitForTimeout(ms);
      return ((await page.evaluate("window.__motion.log")) as Entry[]).slice(from);
    },
  };
};

const ran = (entries: Entry[], match: (e: Entry) => boolean) => entries.some(match);
// Keyframe animations first: colour transitions are many and rarely the point.
const show = (entries: Entry[]) =>
  entries.length === 0
    ? "nothing ran"
    : [...entries.filter((e) => e.kind === "CSSAnimation"), ...entries.filter((e) => e.kind !== "CSSAnimation")]
        .slice(0, 8)
        .map((e) => `${e.kind}:${e.name}${e.pseudo}@${e.target}(${Math.round(e.duration)}ms)`)
        .join(", ");
const centre = async (target: Locator) => {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const runningLonger = async (page: Page, ms: number) =>
  (await page.evaluate(
    `document.getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".coach-scale") && Number(a.effect.getComputedTiming().duration) > ${ms}).length`,
  )) as number;

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};

const browser = await chromium.launch();

try {
  for (const [user, name] of [
    [athlete, "Joey Pang"],
    [coach, "Ruairi Deane"],
  ] as const) {
    await db.createRow({
      databaseId: D,
      tableId: "profiles",
      rowId: user.$id,
      data: { user_id: user.$id, display_name: name, sex: "male", units: "kg", created_at: new Date().toISOString() },
      permissions: profilePermissions({ athleteId: user.$id }),
    });
  }
  await linkPair(admin, D, { coachId: coach.$id, coachName: "Ruairi Deane", athleteId: athlete.$id, athleteName: "Joey Pang" });
  created.link = (await rowsOf("coach_athlete_links", "athlete_id", athlete.$id))[0]?.$id ?? "";
  const { ids, created: madeExercises } = await sampleExerciseIds(admin, D);
  created.exercises = madeExercises;
  const outline = sampleProgram(mondayOf(today));
  outline.name = `E2E motion ${stamp}`;
  created.programId = (await writeOutline(opRunner(admin, D, coach.$id), athlete.$id, outline, ids)).programId;
  for (let back = 6; back >= 0; back--) {
    const day = addDays(today, -back);
    const rowId = bodyweightRowId(athlete.$id, day);
    await db.createRow({
      databaseId: D,
      tableId: "bodyweight_entries",
      rowId,
      data: { athlete_id: athlete.$id, weight_kg: 84 - back * 0.1, measured_on: day, recorded_at: new Date().toISOString() },
      permissions: bodyweightPermissions({ athleteId: athlete.$id }),
    });
    created.bodyweight.push(rowId);
  }
  const day1 = outline.blocks[0].weeks[0].days[0].label;
  const editorUrl = `${BASE}/coach/programs/${created.programId}`;
  const athleteUrl = `${BASE}/coach/athletes/${athlete.$id}`;

  // =====================================================================
  console.log("Motion runs, at 1440×900");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await signIn(page, coach.email);
  await page.goto(`${editorUrl}?view=week`);
  const day = page.getByRole("region", { name: day1 });
  check("the editor opens on the week", await appears(day, 30000));
  await page.waitForTimeout(1500);
  const rec = await recorder(page);

  // --- a control under the pointer -------------------------------------
  const addDay = page.getByRole("button", { name: "+ Day", exact: true });
  await addDay.scrollIntoViewIfNeeded();
  const transition = await addDay.evaluate((el) => {
    const s = getComputedStyle(el);
    return { property: s.transitionProperty, duration: s.transitionDuration };
  });
  check(
    "a button carries the shared control transition (120ms, colour and scale)",
    transition.property.includes("background-color") && transition.property.includes("scale") && transition.duration.startsWith("0.12s"),
    `${transition.property} / ${transition.duration}`,
  );
  await rec.mark();
  const at = await centre(addDay);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  let seen = await rec.since(150);
  // Off the button before letting go, so the press is not a click.
  await page.mouse.move(at.x, at.y - 400);
  await page.mouse.up();
  check(
    "hovering it transitions its background",
    ran(seen, (e) => e.kind === "CSSTransition" && e.name === "background-color" && e.target.includes("button")),
    show(seen),
  );
  check(
    "pressing it scales it under the pointer",
    ran(seen, (e) => e.kind === "CSSTransition" && e.name === "scale" && e.target.includes("button")),
    show(seen),
  );

  // --- the same feedback from the keyboard ------------------------------
  await page.getByRole("textbox", { name: "Program name" }).click();
  await page.keyboard.press("Tab"); // the Week tab
  await rec.mark();
  await page.keyboard.press("Tab"); // the Calendar tab, focus-visible
  seen = await rec.since(300);
  check(
    "a keyboard focus gets the hover's colour transition (focus-visible)",
    ran(seen, (e) => e.kind === "CSSTransition" && e.name === "color" && e.target.startsWith("button|tab")),
    show(seen),
  );

  // --- switching view -----------------------------------------------------
  await rec.mark();
  await page.getByRole("tab", { name: "Calendar" }).click();
  const grid = page.getByRole("grid", { name: "Program calendar" });
  await grid.waitFor({ timeout: 20000 });
  seen = await rec.since();
  check(
    "switching to Calendar fades the calendar in",
    ran(seen, (e) => e.name === "fade-in" && e.target.startsWith("section|Calendar")),
    show(seen),
  );
  check(
    "and the selected tab's rule grows in under it",
    ran(seen, (e) => e.kind === "CSSTransition" && e.name === "scale" && e.pseudo === "::after" && e.target.startsWith("button|tab")),
    show(seen),
  );

  // --- opening a day from the calendar ------------------------------------
  await rec.mark();
  await grid.getByRole("button", { name: new RegExp(`${day1}:`) }).click();
  await day.waitFor({ timeout: 20000 });
  seen = await rec.since(300);
  check(
    "opening a day lands on it with a tint on the day card",
    ran(seen, (e) => e.name === "flash" && e.pseudo === "::after" && e.target.startsWith(`section|${day1}`)),
    show(seen),
  );

  // --- the typeahead --------------------------------------------------------
  const add = page.getByRole("combobox", { name: `Add exercise to ${day1}` });
  await add.scrollIntoViewIfNeeded();
  await rec.mark();
  await add.click();
  await page.getByRole("listbox", { name: `Add exercise to ${day1} results` }).waitFor({ timeout: 5000 });
  seen = await rec.since(250);
  check("the typeahead list pops open", ran(seen, (e) => e.name === "pop-in" && e.target.startsWith("ul|")), show(seen));
  await rec.mark();
  await page.keyboard.press("ArrowDown");
  seen = await rec.since(300);
  check(
    "the active option's rule follows the arrow key",
    ran(seen, (e) => e.kind === "CSSTransition" && e.name === "scale" && e.pseudo === "::before" && e.target.includes("button|")),
    show(seen),
  );

  // --- adding and removing a line -------------------------------------------
  await rec.mark();
  await add.fill("Leg Press");
  await page.keyboard.press("Enter");
  const newRow = day.getByRole("row", { name: `${day1} line 5: Leg Press` });
  check("a line added by the typeahead arrives", await appears(newRow));
  seen = await rec.since(300);
  check(
    "and fades into the grid",
    ran(seen, (e) => e.name === "fade-in" && e.target.startsWith(`tr|${day1} line 5`)),
    show(seen),
  );
  await rec.mark();
  await day.getByRole("button", { name: "Remove line 5" }).click();
  seen = await rec.since(150);
  check(
    "removing it fades it out at once, ahead of the server",
    ran(seen, (e) => e.name === "row-out" && e.target.startsWith(`tr|${day1} line 5`)),
    show(seen),
  );
  check(
    "and it is gone",
    await newRow
      .waitFor({ state: "detached", timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );
  await page.waitForTimeout(1500);

  // --- a line on screen before the server answers -----------------------------
  // /api/program held for 2.5s on addPrescription only, so the placeholder
  // has to be on screen, pending and typeable, while the write is in flight.
  const dayRow = (await rowsOf("program_days", "program_id", created.programId)).find((r) => r.label === day1)!;
  const linesOnDay1 = async () => rowsOf("prescriptions", "day_id", dayRow.$id);
  const addOp = (route: { request: () => { postDataJSON: () => unknown } }) =>
    (route.request().postDataJSON() as { op?: string } | null)?.op === "addPrescription";
  let answered = false;
  await page.route("**/api/program", async (route) => {
    if (!addOp(route)) return route.continue();
    await new Promise((r) => setTimeout(r, 2500));
    const response = await route.fetch();
    answered = true;
    await route.fulfill({ response });
  });
  await add.fill("Front Squat");
  await page.keyboard.press("Enter");
  const pendingRow = day.getByRole("row", { name: `${day1} line 5: Front Squat` });
  check("an added line is on screen before the server has answered", (await appears(pendingRow, 1500)) && !answered);
  check("marked pending", (await pendingRow.getAttribute("aria-busy")) === "true");
  check(
    "with the keyboard already on its Sets cell",
    (await page.evaluate("document.activeElement?.getAttribute('aria-label')")) === "Sets, line 5",
  );
  await pendingRow.evaluate((el) => el.setAttribute("data-probe", "placeholder"));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await page
    .waitForFunction(
      `(() => { const r = document.querySelector('tr[data-probe="placeholder"]'); return r && !r.hasAttribute('aria-busy') && !r.getAttribute('data-line').startsWith('pending'); })()`,
      undefined,
      { timeout: 20000 },
    )
    .catch(() => {});
  check("the server's answer came after it", answered);
  const claimed = await page.evaluate(`(() => {
    const r = document.querySelector('tr[data-probe="placeholder"]');
    const sets = r && r.querySelector('input[aria-label="Sets, line 5"]');
    return { same: Boolean(r && !r.getAttribute('data-line').startsWith('pending')), sets: sets ? sets.value : null,
      focus: document.activeElement?.getAttribute('aria-label') ?? null };
  })()`) as { same: boolean; sets: string | null; focus: string | null };
  check(
    "the real row takes the placeholder's place: same element, the typed 4 kept, focus where the coach left it",
    claimed.same && claimed.sets === "4" && claimed.focus === "Reps, line 5",
    JSON.stringify(claimed),
  );
  const frontSquat = (await linesOnDay1()).find((r) => r.exercise_id === ids["Front Squat"]);
  const stored = frontSquat
    ? (await poll(async () => (await linesOnDay1()).find((r) => r.$id === frontSquat.$id), (r) => r?.set_count === 4))?.set_count
    : null;
  check("and the 4 typed while it was pending is saved against the real line", stored === 4, `set_count ${stored}`);
  await page.unroute("**/api/program");

  // Refused: the placeholder goes, the error says why, nothing is stored.
  const before = (await linesOnDay1()).length;
  await page.route("**/api/program", async (route) => {
    if (!addOp(route)) return route.continue();
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ reason: "Refused by the e2e" }) });
  });
  await add.fill("Leg Press");
  await rec.mark();
  await page.keyboard.press("Enter");
  const refusedRow = day.getByRole("row", { name: `${day1} line 6: Leg Press` });
  check("a refused add shows its placeholder first", await appears(refusedRow, 700));
  check("then says why", await appears(page.getByRole("alert").filter({ hasText: "Refused by the e2e" }), 5000));
  seen = await rec.since(300);
  check(
    "and fades the placeholder out",
    ran(seen, (e) => e.name === "row-out" && e.target.startsWith(`tr|${day1} line 6`)),
    show(seen),
  );
  check(
    "until it is gone",
    await page
      .locator(`tr[aria-label="${day1} line 6: Leg Press"]`)
      .waitFor({ state: "detached", timeout: 3000 })
      .then(() => true)
      .catch(() => false),
  );
  check("with nothing stored", (await linesOnDay1()).length === before);
  await page.unroute("**/api/program");
  await page.waitForTimeout(500);

  // --- a cell saved, a cell refused ------------------------------------------
  const reps = day.getByRole("textbox", { name: "Reps, line 1" });
  await reps.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("6");
  await rec.mark();
  await page.keyboard.press("Tab");
  seen = await rec.since(1500);
  check(
    "a saved cell tints saved",
    ran(seen, (e) => e.name === "flash" && e.pseudo === "::after" && e.target.includes("flash=saved")),
    show(seen),
  );
  const sets = day.getByRole("textbox", { name: "Sets, line 2" });
  await sets.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("abc");
  await rec.mark();
  await page.keyboard.press("Tab");
  seen = await rec.since(600);
  check(
    "a refused cell tints refused and its reason rises in",
    ran(seen, (e) => e.name === "flash" && e.target.includes("flash=failed")) &&
      ran(seen, (e) => e.name === "rise-in" && e.target.startsWith("span|alert")),
    show(seen),
  );
  await sets.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("3");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(1500);

  // --- the week's menu --------------------------------------------------------
  await rec.mark();
  await page.getByRole("button", { name: "Week 1 actions" }).click();
  seen = await rec.since(250);
  check("a ⋯ menu pops from its trigger", ran(seen, (e) => e.name === "pop-in" && e.target.startsWith("div|Week 1 actions")), show(seen));
  await page.keyboard.press("Escape");

  // --- the context drawer ------------------------------------------------------
  await rec.mark();
  await page.getByRole("button", { name: "Context", exact: true }).click();
  const drawer = page.locator("aside[aria-label='Context']");
  await drawer.waitFor({ timeout: 5000 });
  seen = await rec.since(350);
  check("the context drawer slides in", ran(seen, (e) => e.name === "drawer-in" && e.target.startsWith("aside|Context")), show(seen));
  await rec.mark();
  await drawer.getByRole("button", { name: "Close" }).click();
  const leaving = await drawer.evaluate((el) => ({ connected: el.isConnected, hidden: el.getAttribute("aria-hidden") }));
  check(
    "closing it keeps it on screen while it leaves, already hidden from assistive tech",
    leaving.connected && leaving.hidden === "true",
    JSON.stringify(leaving),
  );
  seen = await rec.since(100);
  check("and it slides out", ran(seen, (e) => e.name === "drawer-out"), show(seen));
  check(
    "then it is unmounted",
    await drawer
      .waitFor({ state: "detached", timeout: 3000 })
      .then(() => true)
      .catch(() => false),
  );

  // --- publishing a week ----------------------------------------------------------
  const outlineNav = page.getByRole("navigation", { name: "Program outline" });
  await outlineNav.getByRole("button", { name: "Week 3, draft", exact: true }).click();
  await page.getByRole("button", { name: "Publish Week 3" }).waitFor({ timeout: 20000 });
  await rec.mark();
  await page.getByRole("button", { name: "Publish Week 3" }).click();
  check("publishing a week", await appears(outlineNav.getByRole("button", { name: "Week 3, live", exact: true })));
  seen = await rec.since(300);
  check(
    "pops its new state mark in the outline",
    ran(seen, (e) => e.name === "pop-in" && e.target.includes("state=live")),
    show(seen),
  );
  check(
    "and the week's dates line says Live with a rise",
    ran(seen, (e) => e.name === "rise-in" && e.target.startsWith("p|")),
    show(seen),
  );

  // --- the athlete view ---------------------------------------------------------
  await page.goto(athleteUrl);
  const bw = page.getByRole("button", { name: /Bodyweight/ });
  check("the athlete view shows the bodyweight figure", await appears(bw, 30000));
  await page.waitForTimeout(1000);
  const rec2 = await recorder(page);
  await rec2.mark();
  await bw.click();
  const dialog = page.getByRole("dialog", { name: /Bodyweight/ });
  await dialog.waitFor({ timeout: 5000 });
  seen = await rec2.since(400);
  check(
    "the bodyweight dialog fades and settles in",
    ran(seen, (e) => e.kind === "CSSTransition" && e.name === "opacity" && e.target.startsWith("dialog")) &&
      ran(seen, (e) => e.kind === "CSSTransition" && e.name === "scale" && e.target.startsWith("dialog")),
    show(seen),
  );
  check(
    "over a fading backdrop",
    ran(seen, (e) => e.name === "opacity" && e.pseudo === "::backdrop"),
    show(seen),
  );
  await rec2.mark();
  await page.keyboard.press("Escape");
  // Closing goes back in history, which lands a moment later.
  await page.waitForFunction("!document.querySelector('dialog')?.open", undefined, { timeout: 5000 }).catch(() => {});
  const closing = await page.evaluate(() => {
    const el = document.querySelector("dialog");
    const active = document.activeElement;
    return {
      mounted: Boolean(el),
      open: el?.open ?? null,
      hidden: el?.getAttribute("aria-hidden") ?? null,
      focus: active?.textContent?.includes("Bodyweight") ?? false,
    };
  });
  check(
    "Escape closes it at once -- not modal, hidden, focus back on the figure -- while it stays mounted to fade",
    closing.mounted && closing.open === false && closing.hidden === "true" && closing.focus,
    JSON.stringify(closing),
  );
  seen = await rec2.since(150);
  check("and it fades out", ran(seen, (e) => e.kind === "CSSTransition" && e.name === "opacity" && e.target.startsWith("dialog")), show(seen));
  check(
    "then it is unmounted",
    await page
      .locator("dialog")
      .waitFor({ state: "detached", timeout: 3000 })
      .then(() => true)
      .catch(() => false),
  );

  await rec2.mark();
  await page.getByRole("button", { name: /Load suggestions/ }).click();
  seen = await rec2.since(300);
  check(
    "the load-suggestions gear turns and its panel pops open",
    ran(seen, (e) => e.kind === "CSSTransition" && e.name === "rotate" && e.target.startsWith("svg")) &&
      ran(seen, (e) => e.name === "pop-in"),
    show(seen),
  );
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Set training max for Bench Press" }).click();
  await page.getByLabel("training max for Bench Press, kg").fill("110");
  await rec2.mark();
  await page.keyboard.press("Enter");
  check("saving a max", await appears(page.getByRole("status").getByText(/Saved 110 training max on Bench Press/), 15000));
  seen = await rec2.since(400);
  check(
    "tints the cell it went into and raises its confirmation",
    // Before the re-read lands the cell still says "Set"; after, "Change".
    ran(seen, (e) => e.name === "flash" && e.target.includes("flash=saved") && e.target.includes("training max for Bench Press")) &&
      ran(seen, (e) => e.name === "rise-in" && e.target.startsWith("p|status")),
    show(seen),
  );
  await ctx.close();

  // =====================================================================
  console.log("\nReduced motion: nothing animates");
  const calm = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const still = await calm.newPage();
  await signIn(still, coach.email);
  await still.goto(`${editorUrl}?view=week`);
  await still.getByRole("region", { name: day1 }).waitFor({ timeout: 30000 });
  await still.waitForTimeout(1500);
  const quiet = await recorder(still);
  const floor = await still
    .getByRole("button", { name: "+ Day", exact: true })
    .evaluate((el) => getComputedStyle(el).transitionDuration.split(",")[0].trim());
  check("a button's transition is collapsed to nothing", floor === "1e-05s" || floor === "0s", floor);

  // One window over every interaction, so a single long one anywhere fails it.
  await quiet.mark();
  await still.getByRole("tab", { name: "Calendar" }).click();
  await still.getByRole("grid", { name: "Program calendar" }).waitFor({ timeout: 20000 });
  check("mid-switch, nothing is running", (await runningLonger(still, 1)) === 0);
  const viewFade = await still
    .locator("section[aria-label='Calendar']")
    .evaluate((el) => getComputedStyle(el).animationDuration);
  check("the view's fade is collapsed to nothing", viewFade === "1e-05s" || viewFade === "0s", viewFade);
  await still.getByRole("grid", { name: "Program calendar" }).getByRole("button", { name: new RegExp(`${day1}:`) }).click();
  const stillDay = still.getByRole("region", { name: day1 });
  await stillDay.waitFor({ timeout: 20000 });
  const stillAdd = still.getByRole("combobox", { name: `Add exercise to ${day1}` });
  await stillAdd.scrollIntoViewIfNeeded();
  await stillAdd.click();
  await still.keyboard.press("ArrowDown");
  check("with the typeahead open, nothing is running", (await runningLonger(still, 1)) === 0);
  await still.keyboard.press("Escape");
  await still.getByRole("button", { name: "Week 1 actions" }).click();
  await still.keyboard.press("Escape");
  const stillReps = stillDay.getByRole("textbox", { name: "Reps, line 1" });
  await stillReps.click();
  await still.keyboard.press("ControlOrMeta+a");
  await still.keyboard.type("5");
  await still.keyboard.press("Tab");
  await still.waitForTimeout(1500);
  await still.getByRole("button", { name: "Context", exact: true }).click();
  const stillDrawer = still.locator("aside[aria-label='Context']");
  await stillDrawer.waitFor({ timeout: 5000 });
  await stillDrawer.getByRole("button", { name: "Close" }).click();
  check(
    "the drawer closes at once",
    await stillDrawer
      .waitFor({ state: "detached", timeout: 300 })
      .then(() => true)
      .catch(() => false),
  );
  let all = await quiet.since(300);
  let long = all.filter((e) => e.coach && e.duration > 1);
  check("no animation or transition in the editor is longer than 1ms", long.length === 0, show(long));

  await still.goto(athleteUrl);
  const stillBw = still.getByRole("button", { name: /Bodyweight/ });
  await stillBw.waitFor({ timeout: 30000 });
  await still.waitForTimeout(1000);
  const quiet2 = await recorder(still);
  await quiet2.mark();
  await stillBw.click();
  await still.getByRole("dialog", { name: /Bodyweight/ }).waitFor({ timeout: 5000 });
  await still.keyboard.press("Escape");
  check(
    "the bodyweight dialog closes and unmounts at once",
    await still
      .locator("dialog")
      .waitFor({ state: "detached", timeout: 300 })
      .then(() => true)
      .catch(() => false),
  );
  await still.getByRole("button", { name: /Load suggestions/ }).click();
  await still.keyboard.press("Escape");
  all = await quiet2.since(300);
  long = all.filter((e) => e.coach && e.duration > 1);
  check("no animation or transition on the athlete view is longer than 1ms", long.length === 0, show(long));
  await calm.close();
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  const del = (tableId: string, rowId: string) => db.deleteRow({ databaseId: D, tableId, rowId }).catch(() => {});
  if (created.programId) {
    for (const tableId of PROGRAM_TABLES) {
      const rows =
        tableId === "programs" ? [{ $id: created.programId }] : await rowsOf(tableId, "program_id", created.programId).catch(() => []);
      for (const row of rows) await del(tableId, row.$id);
    }
  }
  for (const id of created.bodyweight) await del("bodyweight_entries", id);
  // Keyed on the throwaway athlete, so it can only be ours: the max set above.
  for (const tableId of ["reference_maxes", "bodyweight_entries"]) {
    for (const row of await rowsOf(tableId, "athlete_id", athlete.$id).catch(() => [])) await del(tableId, row.$id);
  }
  if (created.link) await del("coach_athlete_links", created.link);
  for (const id of created.exercises) await del("exercises", id);
  for (const u of [athlete, coach]) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
