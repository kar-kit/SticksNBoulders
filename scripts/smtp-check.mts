/**
 * Sends one real password-reset email, then reports whether the mail worker
 * accepted it.
 *
 *   npm run smtp:check -- you@yourdomain.com
 *
 * Appwrite returning 200 only means the mail was queued. This also watches the
 * failed-jobs queue, which is what separates "handed to Resend" from "Resend
 * refused it" -- the difference an athlete experiences as silence.
 *
 * Delivery itself still needs a human looking at an inbox. With Resend's
 * onboarding@resend.dev sender, only the Resend account owner ever receives
 * anything, so use an address you can actually read.
 *
 * Creates a temporary account for the address and deletes it afterwards. If
 * the address already has an account, that one is used and left alone.
 */
import { Account, Client, ID, Query, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { looksLikeEmail, normaliseEmail } from "../lib/auth/method-hint";

dedupeSdkWarnings();

const raw = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!raw || !looksLikeEmail(normaliseEmail(raw))) {
  console.error("Usage: npm run smtp:check -- you@yourdomain.com");
  process.exit(1);
}
const email = normaliseEmail(raw);

const config = serverAppwriteConfig();
const users = new Users(createServerClient(config));
const anon = () => new Account(new Client().setEndpoint(config.endpoint).setProject(config.projectId));

const failedJobs = async (): Promise<number> => {
  const response = await fetch(`${config.endpoint}/health/queue/failed/v1-mails`, {
    headers: { "X-Appwrite-Project": config.projectId, "X-Appwrite-Key": config.apiKey },
  });
  return ((await response.json()) as { size: number }).size;
};

const existing = await users.list({ queries: [Query.equal("email", email), Query.limit(1)] });
const reused = existing.users[0];
const user =
  reused ??
  (await users.create({ userId: ID.unique(), email, password: `Smtp-check-${Date.now()}!`, name: "SMTP check" }));
console.log(reused ? `Using the existing account for ${email}` : `Created a temporary account for ${email}`);

const before = await failedJobs();

try {
  await anon().createRecovery({ email, url: "http://localhost:3000/sign-in/reset" });
  console.log("Appwrite accepted and queued the email.");
} catch (error) {
  const e = error as { code?: number; type?: string; message?: string };
  console.error(`\nAppwrite refused it: ${e.code} ${e.type} — ${e.message}`);
  if (e.type === "general_smtp_disabled") {
    console.error("  No SMTP host configured. See docs/appwrite-smtp.md, section 3.");
  }
  if (!reused) await users.delete({ userId: user.$id });
  process.exit(1);
}

process.stdout.write("Watching the failed-jobs queue");
let after = before;
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
  after = await failedJobs();
  if (after > before) break;
}
console.log("");

if (!reused) await users.delete({ userId: user.$id });

if (after > before) {
  console.error(`\nThe send FAILED (failed jobs ${before} -> ${after}).`);
  console.error("Appwrite queued it; the SMTP server refused it. Usual causes, in order:");
  console.error("  1. _APP_SYSTEM_EMAIL_ADDRESS is not on a domain verified in Resend");
  console.error("     (the default team@appwrite.io will always be rejected)");
  console.error("  2. port and _APP_SMTP_SECURE disagree — 465 wants ssl, 587 wants tls");
  console.error("  3. the API key is wrong, or has whitespace around it");
  process.exitCode = 1;
} else {
  console.log(`\nHanded off cleanly — no new failed jobs (${before} -> ${after}).`);
  console.log(`Now check ${email}. If nothing arrives, the sender domain is not verified in Resend.`);
  console.log("When it does arrive, paste the reset link's query string back — it settles whether");
  console.log("Appwrite includes the email alongside userId and secret.");
}
