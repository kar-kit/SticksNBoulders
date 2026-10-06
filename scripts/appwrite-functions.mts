/**
 * Deploys the Appwrite Functions declared in appwrite/functions/index.ts.
 *
 *   npm run appwrite:functions -- --dry-run   # bundles and plans, uploads nothing
 *   npm run appwrite:functions                # creates/updates, deploys, waits for the build
 *
 * One command, idempotent, like appwrite:setup. Never click a Function into
 * existence in the console: its events and scopes are part of the permission
 * model, and the instance is one we plan to migrate off.
 *
 * Each function's src/main.ts is bundled with esbuild into a single file, so
 * it can import appwrite/documents/provenance.ts -- the same code the readers
 * use -- rather than carry a copy. The bundle is the deployment; the source is
 * what is reviewed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { Functions, ID, Query, Runtime, type Models } from "node-appwrite";
import { FUNCTIONS, type FunctionSpec } from "../appwrite/functions";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";

dedupeSdkWarnings();

const dryRun = process.argv.includes("--dry-run");
const config = serverAppwriteConfig();
const functions = new Functions(createServerClient(config));
const ENTRYPOINT = "src/main.js";
const BUILD_TIMEOUT_MS = 240_000;

console.log(`${dryRun ? "Planning" : "Deploying"} ${FUNCTIONS.length} function(s) -> ${config.endpoint}\n`);

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

async function bundle(spec: FunctionSpec): Promise<string> {
  const root = resolve("functions", spec.dir);
  const dist = resolve(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(resolve(dist, "src"), { recursive: true });
  await build({
    entryPoints: [resolve(root, "src/main.ts")],
    outfile: resolve(dist, ENTRYPOINT),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    // The runtime wants module.exports to be the handler.
    footer: { js: "module.exports = module.exports.default;" },
    logLevel: "silent",
  });
  writeFileSync(resolve(dist, "package.json"), JSON.stringify({ name: spec.id, private: true, main: ENTRYPOINT }, null, 2));
  const archive = resolve(root, "dist.tar.gz");
  rmSync(archive, { force: true });
  execFileSync("tar", ["-czf", archive, "-C", dist, "."]);
  return archive;
}

async function ensureFunction(spec: FunctionSpec): Promise<{ fn: Models.Function | null; changed: string[] }> {
  const desired = {
    functionId: spec.id,
    name: spec.name,
    runtime: spec.runtime as Runtime,
    // Nobody may execute it over HTTP. Events are the only way in.
    execute: [] as string[],
    events: [...spec.events],
    timeout: spec.timeoutSeconds,
    enabled: true,
    logging: true,
    entrypoint: ENTRYPOINT,
    scopes: [...spec.scopes] as never[],
  };
  let existing: Models.Function | null = null;
  try {
    existing = await functions.get({ functionId: spec.id });
  } catch {
    /* not yet */
  }
  const changed: string[] = [];
  if (!existing) changed.push("create");
  else {
    if (existing.runtime !== desired.runtime) changed.push(`runtime ${existing.runtime} -> ${desired.runtime}`);
    if (!same(existing.events, desired.events)) changed.push("events");
    if (!same(existing.scopes, desired.scopes)) changed.push("scopes");
    if (!same(existing.execute, desired.execute)) changed.push("execute");
    if (existing.timeout !== desired.timeout) changed.push(`timeout ${existing.timeout} -> ${desired.timeout}`);
    if (!existing.enabled) changed.push("enabled");
    if (!existing.logging) changed.push("logging");
    if (existing.entrypoint !== ENTRYPOINT) changed.push("entrypoint");
  }
  if (dryRun) return { fn: existing, changed };
  if (!existing) return { fn: await functions.create(desired), changed };
  if (changed.length > 0) return { fn: await functions.update(desired), changed };
  return { fn: existing, changed };
}

async function ensureVariables(spec: FunctionSpec): Promise<string[]> {
  const want: Record<string, string> = {
    ...spec.variables,
    // The public endpoint, because APPWRITE_FUNCTION_API_ENDPOINT inside the
    // runtime container may name a host the container cannot resolve.
    APPWRITE_ENDPOINT: config.endpoint,
  };
  const changed: string[] = [];
  let have: Models.Variable[] = [];
  try {
    have = (await functions.listVariables({ functionId: spec.id, queries: [Query.limit(100)] })).variables;
  } catch {
    /* function does not exist yet in a dry run */
  }
  for (const [key, value] of Object.entries(want)) {
    const current = have.find((v) => v.key === key);
    if (current?.value === value) continue;
    changed.push(current ? `${key} (update)` : `${key} (create)`);
    if (dryRun) continue;
    if (current) await functions.updateVariable({ functionId: spec.id, variableId: current.$id, key, value });
    else await functions.createVariable({ functionId: spec.id, variableId: ID.unique(), key, value });
  }
  return changed;
}

async function deploy(spec: FunctionSpec, archive: string): Promise<Models.Deployment> {
  let deployment = await functions.createDeployment({
    functionId: spec.id,
    code: new File([readFileSync(archive)], "code.tar.gz"),
    activate: true,
    entrypoint: ENTRYPOINT,
  });
  const started = Date.now();
  while (!["ready", "failed", "canceled"].includes(deployment.status)) {
    if (Date.now() - started > BUILD_TIMEOUT_MS) throw new Error(`build of ${spec.id} did not finish in ${BUILD_TIMEOUT_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, 2000));
    deployment = await functions.getDeployment({ functionId: spec.id, deploymentId: deployment.$id });
  }
  return deployment;
}

let failed = false;
for (const spec of FUNCTIONS) {
  console.log(`${spec.id}  (${spec.runtime}, ${spec.events.length} events, scopes ${spec.scopes.join(" ")})`);
  const archive = await bundle(spec);
  console.log(`  bundled functions/${spec.dir}/src/main.ts -> ${archive.replace(process.cwd() + "/", "")}`);

  const { fn, changed } = await ensureFunction(spec);
  console.log(`  function: ${changed.length ? changed.join(", ") : "up to date"}`);
  const vars = await ensureVariables(spec);
  console.log(`  variables: ${vars.length ? vars.join(", ") : "up to date"}`);

  if (dryRun) {
    console.log(`  deployment: would upload and activate${fn?.deploymentId ? ` (replacing ${fn.deploymentId})` : ""}`);
    continue;
  }
  const deployment = await deploy(spec, archive);
  if (deployment.status !== "ready") {
    failed = true;
    console.log(`  deployment ${deployment.$id}: ${deployment.status}`);
    console.log(deployment.buildLogs.split("\n").slice(-30).map((l) => `    ${l}`).join("\n"));
    continue;
  }
  const after = await functions.get({ functionId: spec.id });
  const active = after.deploymentId === deployment.$id;
  if (!active) failed = true;
  console.log(`  deployment ${deployment.$id}: ready, ${active ? "active" : "NOT active"} (${deployment.buildSize} bytes built)`);
}

console.log("");
if (dryRun) console.log("Dry run. Re-run without --dry-run to deploy.");
else if (failed) {
  console.log("A deployment failed. Nothing above it was rolled back.");
  process.exitCode = 1;
} else console.log("Every function is deployed and active.");
