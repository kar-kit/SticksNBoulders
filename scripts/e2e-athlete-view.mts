/**
 * Drives the coach's Athlete View against the live instance, in a browser.
 *
 *   npx next build --webpack && npx next start -p 3204
 *   E2E_BASE_URL=http://localhost:3204 npm run e2e:athlete-view
 *
 * What only the instance can prove:
 *
 *   - A linked coach reads every panel through the circle team: maxes and
 *     DOTS, the lift tabs off stats_rollups, sessions and their sets, the
 *     current block's week, bodyweight, clips and their comment threads.
 *   - The dashboard's layout rules, with real mouse and keyboard events: the
 *     header carries the link pill and the bodyweight, which opens its own
 *     view that Back and Escape both close; CURRENT MAXES lists squat, bench
 *     and deadlift and nothing else, with DOTS in the same table; the Lifts
 *     tabs lead with the same three; load suggestions sit behind a compact
 *     control; videos are buttons, and a clip plays only once one is opened,
 *     beside its thread.
 *   - The inline max editor writes through /api/reference-max as the coach,
 *     and Undo deletes exactly the row it wrote.
 *   - The gate reads coach_athlete_links: a stranger gets "Not one of your
 *     athletes", and a revoked coach gets "No longer linked" -- which depends
 *     on the coach still being able to read their own revoked link row.
 *   - It fits at 1280 as well as 1440.
 *
 * Creates throwaway users and only ever deletes rows it created. Rollups are
 * built for this athlete only, bucket by bucket -- never `rollups:rebuild`,
 * which walks every athlete on a shared instance.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { ID, Query, Storage, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { bodyweightRowId } from "../appwrite/documents";
import { adminRollupTables, rebuildRollup } from "../appwrite/documents/rollup-admin";
import {
  bodyweightPermissions,
  commentPermissions,
  linkPermissions,
  profilePermissions,
  referenceMaxPermissions,
  reviewPermissions,
  sessionPermissions,
  setPermissions,
  videoPermissions,
} from "../appwrite/documents/policy";
import { adjustProgramHref } from "../lib/coach/adjust-program";
import { notLinkedCopy } from "../lib/coach/link-status";
import { addDays, localDay } from "../lib/programming/program";
import { sampleProgram, writeOutline } from "../lib/programming/sample-program";
import { estimateOneRepMax } from "../lib/strength/e1rm";
import { weekStart } from "../lib/strength/rollup";
import { opRunner, sampleExerciseIds } from "./program-fixtures";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const storage = new Storage(admin);
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
  users.create({ userId: ID.unique(), email: `av-${tag}-${stamp}@example.com`, password: PASSWORD, name });

type Fixture = Awaited<ReturnType<typeof mkUser>>;
// Assigned inside the try, so a throw while creating them still reaches the
// finally that deletes them.
let athlete!: Fixture;
let coach!: Fixture;
let stranger!: Fixture;

const created = {
  sessions: [] as string[],
  sets: [] as string[],
  comments: [] as string[],
  reviews: [] as string[],
  exercises: [] as string[],
  bodyweight: [] as string[],
  link: "",
  programId: "",
  videoFileId: "",
};

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};

const appears = (locator: Locator, timeout = 20000) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
const gone = (locator: Locator, timeout = 10000) =>
  locator
    .first()
    .waitFor({ state: "hidden", timeout })
    .then(() => true)
    .catch(() => false);
const visible = (page: Page, text: string | RegExp, timeout = 20000) => appears(page.getByText(text), timeout);
const textOf = async (locator: Locator) => ((await locator.innerText({ timeout: 5000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");

/**
 * Two seconds of a test pattern, so the clip in the dialog actually plays and
 * the screenshot shows a frame. Falls back to a few bytes that will not decode,
 * which still proves the player and thread open together -- the player says
 * the clip would not play instead.
 */
const fixtureClip = (): Buffer => {
  const dir = mkdtempSync(join(tmpdir(), "snb-av-"));
  try {
    const out = join(dir, "clip.mp4");
    execFileSync(
      "ffmpeg",
      ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=240x320:rate=30", "-t", "2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", out],
      { stdio: "ignore" },
    );
    return readFileSync(out);
  } catch {
    return Buffer.from("fixture clip");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const browser = await chromium.launch();

try {
  athlete = await mkUser("a", "Joey Pang");
  coach = await mkUser("c", "Ruairi Deane");
  stranger = await mkUser("s", "Louis Stranger");

  // --- the athlete, linked -------------------------------------------------
  await ensureCircle(teams, athlete.$id, "Joey Pang");
  await addCoachToCircle(teams, athlete.$id, coach.$id);
  await db.createRow({
    databaseId: D,
    tableId: "profiles",
    rowId: athlete.$id,
    data: { user_id: athlete.$id, display_name: "Joey Pang", sex: "male", units: "kg", created_at: new Date().toISOString() },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });
  created.link = ID.unique();
  await db.createRow({
    databaseId: D,
    tableId: "coach_athlete_links",
    rowId: created.link,
    data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString(), suggestions_mode: "direct" },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });

  const { ids, created: madeExercises } = await sampleExerciseIds(admin, D);
  created.exercises = madeExercises;

  // --- a real clip, uploaded as the athlete --------------------------------
  created.videoFileId = `avclip${stamp}`;
  const bytes = fixtureClip();
  const form = new FormData();
  form.append("fileId", created.videoFileId);
  for (const p of videoPermissions({ athleteId: athlete.$id })) form.append("permissions[]", p);
  form.append("file", new File([new Uint8Array(bytes)], "clip.mp4", { type: "video/mp4" }), "clip.mp4");
  await fetch(`${config.endpoint}/storage/buckets/set_videos/files`, {
    method: "POST",
    headers: {
      "x-appwrite-project": config.projectId,
      "x-appwrite-jwt": (await users.createJWT({ userId: athlete.$id })).jwt,
      "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      "x-appwrite-id": created.videoFileId,
    },
    body: form,
  });

  // --- three weeks of squats, plus the other two lifts and a variation -----
  const WEEK = 7 * 24 * 60 * 60_000;
  const monday = weekStart(new Date()).getTime();
  type Planned = { lift: string; ago: number; load: number; reps: number; rpe: number; video?: boolean; note?: string };
  const planned: Planned[] = [
    { lift: ids.Squat, ago: 2, load: 170, reps: 3, rpe: 8 },
    { lift: ids.Squat, ago: 1, load: 175, reps: 3, rpe: 8 },
    { lift: ids.Squat, ago: 0, load: 180, reps: 3, rpe: 8, video: true, note: "Knee felt fine today" },
    { lift: ids["Bench Press"], ago: 0, load: 120, reps: 5, rpe: 8, video: true },
    { lift: ids.Deadlift, ago: 0, load: 220, reps: 3, rpe: 8 },
    // A variation with an e1RM of its own: the old grid listed it as a fourth
    // row. It must not appear in CURRENT MAXES, and must come after the big
    // three in the Lifts tabs.
    { lift: ids["Pause Squat"], ago: 1, load: 140, reps: 4, rpe: 8 },
  ];
  const setIds: string[] = [];
  for (const [n, w] of planned.entries()) {
    const at = new Date(monday - w.ago * WEEK + (10 + n) * 60 * 60_000);
    const sessionId = `av-s-${stamp}-${n}`;
    await db.createRow({
      databaseId: D,
      tableId: "sessions",
      rowId: sessionId,
      data: {
        athlete_id: athlete.$id,
        client_session_id: sessionId,
        started_at: at.toISOString(),
        finished_at: new Date(at.getTime() + 55 * 60_000).toISOString(),
        set_count: 1,
        tonnage_kg: w.load * w.reps,
        notes: w.note ?? null,
      },
      permissions: sessionPermissions({ athleteId: athlete.$id }),
    });
    created.sessions.push(sessionId);

    const setId = `av-t-${stamp}-${n}`;
    await db.createRow({
      databaseId: D,
      tableId: "sets",
      rowId: setId,
      data: {
        session_id: sessionId,
        athlete_id: athlete.$id,
        exercise_id: w.lift,
        set_index: 0,
        load_kg: w.load,
        reps: w.reps,
        rpe: w.rpe,
        is_warmup: false,
        e1rm_kg: estimateOneRepMax({ loadKg: w.load, reps: w.reps, rpe: w.rpe }) ?? undefined,
        logged_at: new Date(at.getTime() + 5 * 60_000).toISOString(),
        client_set_id: setId,
        video_file_id: w.video ? created.videoFileId : undefined,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
    created.sets.push(setId);
    setIds.push(setId);
    await rebuildRollup(adminRollupTables(admin), D, { athleteId: athlete.$id, exerciseId: w.lift, loggedAt: at });
  }
  const squatClip = setIds[2];
  const benchClip = setIds[3];

  // The bench clip has been dealt with: reviewed, with a thread on it.
  const reviewId = `${coach.$id}_${benchClip}`;
  await db.createRow({
    databaseId: D,
    tableId: "set_reviews",
    rowId: reviewId,
    data: { coach_id: coach.$id, athlete_id: athlete.$id, set_id: benchClip, reviewed_at: new Date().toISOString(), client_review_id: reviewId },
    permissions: reviewPermissions({ athleteId: athlete.$id, coachId: coach.$id }),
  });
  created.reviews.push(reviewId);
  const COACH_SAID = "Elbows flared on rep four. Same weight next week, tuck them.";
  const ATHLETE_SAID = "Got it, felt it too.";
  const said = [
    { id: `avc${stamp}a`, author: coach.$id, body: COACH_SAID, parent: null as string | null, at: stamp - 60_000 },
    { id: `avc${stamp}b`, author: athlete.$id, body: ATHLETE_SAID, parent: `avc${stamp}a`, at: stamp - 30_000 },
  ];
  for (const c of said) {
    await db.createRow({
      databaseId: D,
      tableId: "set_comments",
      rowId: c.id,
      data: {
        set_id: benchClip,
        athlete_id: athlete.$id,
        author_id: c.author,
        body: c.body,
        parent_id: c.parent,
        created_at: new Date(c.at).toISOString(),
        client_comment_id: c.id,
      },
      permissions: commentPermissions({ athleteId: athlete.$id, authorId: c.author }),
    });
    created.comments.push(c.id);
  }

  // A tested squat max, entered by the athlete; a training max, by the coach.
  for (const [kind, value, by] of [["tested", 200, athlete.$id], ["training", 185, coach.$id]] as const) {
    await db.createRow({
      databaseId: D,
      tableId: "reference_maxes",
      rowId: ID.unique(),
      data: {
        athlete_id: athlete.$id,
        exercise_id: ids.Squat,
        kind,
        value_kg: value,
        effective_from: new Date("2026-08-12T00:00:00Z").toISOString(),
        recorded_by: by,
        created_at: new Date().toISOString(),
      },
      permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
    });
  }

  // Twelve days of weigh-ins, drifting down: a cut.
  for (let back = 11; back >= 0; back--) {
    const day = addDays(today, -back);
    const rowId = bodyweightRowId(athlete.$id, day);
    await db.createRow({
      databaseId: D,
      tableId: "bodyweight_entries",
      rowId,
      data: { athlete_id: athlete.$id, weight_kg: 84 - (11 - back) * 0.15, measured_on: day, recorded_at: new Date().toISOString() },
      permissions: bodyweightPermissions({ athleteId: athlete.$id }),
    });
    created.bodyweight.push(rowId);
  }

  // The sample block, started a week ago, so week 2 (published) is current.
  const startOn = addDays(today, -7);
  const written = await writeOutline(opRunner(admin, D, coach.$id), athlete.$id, sampleProgram(startOn), ids);
  created.programId = written.programId;
  // Today's squat session was started from week 2's first day.
  const week2Day1 = written.daysOn.get(today)!;
  await db.updateRow({ databaseId: D, tableId: "sessions", rowId: created.sessions[2], data: { program_day_id: week2Day1 } });

  // --- the coach, at 1440 --------------------------------------------------
  console.log("A linked coach, at 1440×900");
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const coachPage = await coachCtx.newPage();
  await signIn(coachPage, coach.email);
  const started = Date.now();
  const athleteUrl = `${BASE}/coach/athletes/${athlete.$id}`;
  await coachPage.goto(athleteUrl);

  const header = coachPage.locator("main header").first();
  check("the header names the athlete", await appears(coachPage.getByRole("heading", { level: 1, name: "Joey Pang" })));
  const pill = header.getByText(/^linked \d+ \w{3}/);
  check("and says when they linked, as a small pill", await appears(pill));
  const pillStyle = await pill
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, size: parseFloat(s.fontSize), h1: parseFloat(getComputedStyle(document.querySelector("h1")!).fontSize) };
    })
    .catch(() => null);
  check(
    "the pill is bordered and smaller than the name",
    pillStyle !== null && pillStyle.border !== "0px" && pillStyle.size < pillStyle.h1,
    JSON.stringify(pillStyle),
  );

  const maxes = coachPage.getByRole("region", { name: "Current maxes" });
  await appears(maxes.getByText("set by them"));
  await appears(coachPage.getByRole("region", { name: "This block" }).getByText("Week 2 of 4"));
  await coachPage.waitForTimeout(1500);
  await coachPage.screenshot({ path: ".shots/athlete-view-1440.png" });
  await coachPage.screenshot({ path: ".shots/athlete-view-1440-full.png", fullPage: true });
  console.log(`         (screen settled in ${Date.now() - started}ms)`);

  // --- bodyweight, in the header ---------------------------------------------
  console.log("\nBodyweight, next to the name");
  const bwButton = header.getByRole("button", { name: /Bodyweight/ });
  check("the header carries the current weight and the 7-day figure", /\d+\.\d kg/.test(await textOf(bwButton)) && /7-day/.test(await textOf(bwButton)), await textOf(bwButton));
  await bwButton.click();
  const bwDialog = coachPage.getByRole("dialog", { name: /Bodyweight/ });
  check("clicking it opens the bodyweight view", await appears(bwDialog, 5000));
  check("whose URL can be shared and reloaded", new URL(coachPage.url()).searchParams.get("view") === "bodyweight", coachPage.url());
  check("with the chart and its rolling average", await appears(bwDialog.getByRole("img", { name: /bodyweight/i }), 5000));
  check("and the weigh-ins listed", ((await bwDialog.getByRole("listitem").count()) ?? 0) >= 7);
  await bwDialog.getByRole("button", { name: "all" }).click();
  check("the range switches", (await bwDialog.getByRole("button", { name: "all" }).getAttribute("aria-pressed")) === "true");
  await coachPage.screenshot({ path: ".shots/athlete-view-bodyweight-1440.png" });
  await coachPage.goBack();
  check("Back closes it and stays on the athlete", (await gone(bwDialog)) && new URL(coachPage.url()).pathname.endsWith(athlete.$id) && !coachPage.url().includes("view="), coachPage.url());

  await bwButton.focus();
  await coachPage.keyboard.press("Enter");
  check("Enter on the focused button opens it too", await appears(bwDialog, 5000));
  await coachPage.keyboard.press("Escape");
  check("and Escape closes it, back to a clean URL", (await gone(bwDialog)) && !coachPage.url().includes("view="), coachPage.url());
  check("handing focus back to the button", await bwButton.evaluate((el) => el === document.activeElement).catch(() => false));

  await coachPage.goto(`${athleteUrl}?view=bodyweight`);
  check("a deep link opens straight onto it", await appears(bwDialog));
  await bwDialog.getByRole("button", { name: "Close" }).click();
  check("and Close leaves the athlete's page, not the app", (await gone(bwDialog)) && new URL(coachPage.url()).pathname.endsWith(athlete.$id) && !coachPage.url().includes("view="), coachPage.url());

  // --- current maxes ---------------------------------------------------------
  console.log("\nCurrent maxes");
  await appears(maxes.getByText("set by them"));
  const rowNames = await maxes.locator("tbody tr th[scope=row]").allInnerTexts();
  check("lists squat, bench and deadlift, in that order, then DOTS", JSON.stringify(rowNames) === JSON.stringify(["Squat", "Bench Press", "Deadlift", "DOTS"]), JSON.stringify(rowNames));
  check("and no other exercise, even one with an e1RM", (await maxes.getByText("Pause Squat").count()) === 0);
  const squatRow = maxes.getByRole("row", { name: /^Squat/ });
  check("the tested squat says who set it", ((await textOf(squatRow)) ?? "").includes("set by them"));
  check("with the e1RM from the rollups beside it", (await textOf(squatRow)).includes("from logged sets"));
  check("and the marker on the number percentages use", (await squatRow.getByLabel("used for percentages").count()) === 1);
  const dotsRow = maxes.getByRole("row", { name: /^DOTS/ });
  check("DOTS sits in the same table, with its score", /\d{2,3}\.\d/.test(await textOf(dotsRow)), await textOf(dotsRow));
  check("and there is no separate DOTS block", (await coachPage.getByRole("heading", { name: "DOTS", exact: true }).count()) === 0);

  // --- lifts -----------------------------------------------------------------
  await appears(coachPage.getByRole("tab", { name: "Squat" }));
  const tabs = await coachPage.getByRole("tablist", { name: "Lifts" }).getByRole("tab").allInnerTexts();
  check("the Lifts tabs lead with squat, bench, deadlift", JSON.stringify(tabs.slice(0, 3)) === JSON.stringify(["Squat", "Bench Press", "Deadlift"]) && tabs[3] === "Pause Squat", JSON.stringify(tabs));
  check("open on Squat", await appears(coachPage.getByRole("tab", { name: "Squat", selected: true })));
  check("three weeks draws the e1RM chart", await appears(coachPage.getByRole("img", { name: /Estimated 1RM for Squat/ }), 10000));
  check("recent working sets are listed", await visible(coachPage, /180 × 3/));

  const sessions = coachPage.getByRole("region", { name: "Recent sessions" });
  await sessions.getByRole("button", { expanded: false }).filter({ hasText: "Squat" }).first().click();
  check("a session opens in place to its sets and the athlete's note", await appears(sessions.getByText("Knee felt fine today"), 5000));

  // --- this block ------------------------------------------------------------
  console.log("\nThis block");
  const block = coachPage.getByRole("region", { name: "This block" });
  check("names the program and says it is published", (await textOf(block)).includes("Sample block — volume") && (await appears(block.getByText("Published", { exact: true }), 5000)));
  check("shows the current week", await appears(block.getByText("Week 2 of 4"), 5000));
  const day1 = block.getByRole("listitem").filter({ hasText: "Week 2 · Day 1 — squat" });
  check("with its days", (await block.getByText(/Week 2 · Day \d/).count()) === 3);
  check("and their exercises, loads resolved against the training max", /Squat\s*1 × 5 · RPE 8/.test(await textOf(day1)) && /3 × 5 · 142\.5 kg/.test(await textOf(day1)), await textOf(day1));
  check("a day they started is marked logged", (await textOf(day1)).includes("Logged"));
  check(
    "Adjust program still opens their block",
    (await block.getByRole("link", { name: "Adjust program" }).getAttribute("href", { timeout: 20000 }).catch(() => null)) === adjustProgramHref(athlete.$id),
  );
  check("and the placeholder is gone", (await coachPage.getByText(/will sit here later/).count()) === 0);

  // --- load suggestions --------------------------------------------------------
  console.log("\nLoad suggestions, demoted");
  check("no radio panel on the page until asked for", (await coachPage.getByRole("radio").count()) === 0);
  const suggestions = coachPage.getByRole("button", { name: /Load suggestions/ });
  check("a compact control says the current setting", /Athlete sees them directly/.test(await textOf(suggestions)), await textOf(suggestions));
  await suggestions.click();
  await coachPage.getByRole("radio", { name: /Hold them back/ }).check();
  await coachPage.getByText("Saving…").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await coachPage.waitForTimeout(500);
  const mode = (await db.getRow({ databaseId: D, tableId: "coach_athlete_links", rowId: created.link })) as unknown as { suggestions_mode?: string };
  check("it still writes the setting", mode.suggestions_mode === "held", String(mode.suggestions_mode));
  await coachPage.keyboard.press("Escape");
  check("Escape folds it away again", (await gone(coachPage.getByRole("radio").first(), 5000)) && /Hold them back/.test(await textOf(suggestions)));

  // --- videos ------------------------------------------------------------------
  console.log("\nVideos");
  const videos = coachPage.getByRole("region", { name: "Videos" });
  const benchButton = videos.getByRole("button", { name: /Bench Press/ });
  const squatButton = videos.getByRole("button", { name: /Squat/ });
  check("one compact button per clip", (await appears(benchButton)) && (await videos.getByRole("button", { name: /× \d/ }).count()) === 2);
  check("no player on the page until one is opened", (await coachPage.locator("video").count()) === 0);
  check("each says the lift, load × reps and whether it is reviewed", /120 × 5/.test(await textOf(benchButton)) && /reviewed/.test(await textOf(benchButton)) && /waiting/.test(await textOf(squatButton)));
  check("with its recent feedback attached", (await textOf(videos)).includes(ATHLETE_SAID) && /2 comments/.test(await textOf(benchButton)));
  await benchButton.click();
  const clipDialog = coachPage.getByRole("dialog", { name: /Bench Press/ });
  check("opening one shows the clip", (await appears(clipDialog, 5000)) && (await appears(clipDialog.locator("video"), 15000)));
  check("and its thread together", (await textOf(clipDialog)).includes(COACH_SAID) && (await textOf(clipDialog)).includes(ATHLETE_SAID));
  check("with the review queue's player controls", await appears(clipDialog.getByRole("group", { name: "Playback speed" }), 5000));
  check("on its own URL", new URL(coachPage.url()).searchParams.get("clip") === benchClip, coachPage.url());
  await coachPage.waitForTimeout(1500);
  await coachPage.screenshot({ path: ".shots/athlete-view-clip-1440.png" });
  await coachPage.goBack();
  check("Back closes it", (await gone(clipDialog)) && !coachPage.url().includes("clip="), coachPage.url());

  await squatButton.focus();
  await coachPage.keyboard.press("Enter");
  const squatDialog = coachPage.getByRole("dialog", { name: /Squat/ });
  check("the keyboard opens one too", await appears(squatDialog, 5000));
  check("a waiting clip points to the Review queue", (await squatDialog.getByRole("link", { name: /Review/ }).getAttribute("href").catch(() => null)) === "/coach/review");
  check("and says nothing has been said yet", (await textOf(squatDialog)).includes("Nothing said"));
  await coachPage.keyboard.press("Escape");
  check("Escape closes it, focus back on its button", (await gone(squatDialog)) && (await squatButton.evaluate((el) => el === document.activeElement).catch(() => false)));
  void squatClip;

  // --- setting a max inline ------------------------------------------------
  console.log("\nSetting a max inline");
  await coachPage.getByRole("button", { name: "Set training max for Bench Press" }).click();
  await coachPage.getByLabel("training max for Bench Press, kg").fill("122.5");
  await coachPage.keyboard.press("Enter");
  const saved = await appears(coachPage.getByRole("status").getByText(/Saved 122.5 training max on Bench Press/), 15000);
  check("the save is confirmed on screen", saved);

  const benchMaxes = async () =>
    (
      await db.listRows({
        databaseId: D,
        tableId: "reference_maxes",
        queries: [Query.equal("athlete_id", athlete.$id), Query.equal("exercise_id", ids["Bench Press"]), Query.limit(10)],
        ttl: 0,
      })
    ).rows as unknown as Array<Record<string, unknown>>;
  const written2 = await benchMaxes();
  check(
    "one row, recorded by the coach, as a training max",
    written2.length === 1 && written2[0].recorded_by === coach.$id && written2[0].kind === "training" && written2[0].value_kg === 122.5,
    JSON.stringify(written2.map((r) => [r.kind, r.value_kg, r.recorded_by === coach.$id])),
  );
  check("and the grid shows it", await appears(maxes.getByRole("row", { name: /^Bench Press/ }).getByText("set by you"), 10000));
  await coachPage.getByRole("button", { name: "Undo" }).click();
  await coachPage.waitForTimeout(2500);
  check("Undo deletes exactly that row", (await benchMaxes()).length === 0);

  // --- 1280 ----------------------------------------------------------------
  console.log("\nAt 1280×900");
  await coachPage.setViewportSize({ width: 1280, height: 900 });
  await coachPage.waitForTimeout(500);
  const overflow = await coachPage.evaluate(() => {
    const main = document.querySelector("main");
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  check("nothing scrolls sideways", overflow.page <= 0 && overflow.main <= 0, JSON.stringify(overflow));
  await coachPage.screenshot({ path: ".shots/athlete-view-1280.png", fullPage: true });

  // --- a stranger ----------------------------------------------------------
  console.log("\nA coach who was never linked");
  const strangerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const strangerPage = await strangerCtx.newPage();
  await signIn(strangerPage, stranger.email);
  await strangerPage.goto(athleteUrl);
  check("is told this is not their athlete", await visible(strangerPage, "Not one of your athletes"));
  check("and sees none of the training", (await strangerPage.getByText("180 × 3").count()) === 0);
  await strangerPage.goto(`${athleteUrl}?view=bodyweight`);
  await visible(strangerPage, "Not one of your athletes");
  check("not even through the bodyweight link", (await strangerPage.getByRole("dialog").count()) === 0);
  await strangerPage.screenshot({ path: ".shots/athlete-view-not-linked.png" });

  // --- revoked -------------------------------------------------------------
  console.log("\nOnce the athlete ends the link");
  // The same two steps as revokeCoachAccess, in the same order: access first,
  // then the record.
  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
  const membership = memberships.find((m) => m.userId === coach.$id);
  if (membership) await teams.deleteMembership({ teamId: circleTeamId(athlete.$id), membershipId: membership.$id });
  const revokedAt = new Date();
  await db.updateRow({
    databaseId: D,
    tableId: "coach_athlete_links",
    rowId: created.link,
    data: { status: "revoked", revoked_at: revokedAt.toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });
  await coachPage.goto(athleteUrl);
  check("the coach sees 'No longer linked', not an error", await visible(coachPage, "No longer linked"));
  // The gate's own sentence, from the function that writes it, so a copy
  // change cannot break this -- but a missing or wrong date still does.
  const { body } = notLinkedCopy({ kind: "left", revokedAt });
  check("with the date it ended", body.includes(" on ") && (await visible(coachPage, body)), body);
  check("and none of the training", (await coachPage.getByText("180 × 3").count()) === 0);
  check("and not the athlete's name", (await coachPage.getByText("Joey Pang").count()) === 0);
  await coachPage.screenshot({ path: ".shots/athlete-view-revoked.png" });
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  const del = (tableId: string, rowId: string) => db.deleteRow({ databaseId: D, tableId, rowId }).catch(() => {});
  const rowsOf = async (tableId: string, column: string, value: string) =>
    (await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 }))
      .rows as unknown as Array<{ $id: string }>;
  if (created.programId) {
    for (const tableId of PROGRAM_TABLES) {
      const rows = tableId === "programs" ? [{ $id: created.programId }] : await rowsOf(tableId, "program_id", created.programId).catch(() => []);
      for (const row of rows) await del(tableId, row.$id);
    }
  }
  for (const id of created.comments) await del("set_comments", id);
  for (const id of created.reviews) await del("set_reviews", id);
  for (const id of created.sets) await del("sets", id);
  for (const id of created.sessions) await del("sessions", id);
  for (const id of created.bodyweight) await del("bodyweight_entries", id);
  // Everything below is keyed on the throwaway athlete, so it can only be ours.
  if (athlete) {
    for (const tableId of ["stats_rollups", "reference_maxes", "bodyweight_entries", "set_comments", "sets", "sessions"]) {
      for (const row of await rowsOf(tableId, "athlete_id", athlete.$id).catch(() => [])) await del(tableId, row.$id);
    }
  }
  if (created.videoFileId) await storage.deleteFile({ bucketId: "set_videos", fileId: created.videoFileId }).catch(() => {});
  if (created.link) await del("coach_athlete_links", created.link);
  for (const id of created.exercises) await del("exercises", id);
  if (athlete) {
    await del("profiles", athlete.$id);
    await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  }
  for (const u of [athlete, coach, stranger].filter(Boolean)) {
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
