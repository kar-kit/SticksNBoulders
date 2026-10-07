import { join } from "node:path";
import { FILE_STORE, MANIFEST } from "./files";

/**
 * Getting a dump off the machine.
 *
 * `SNB_BACKUP_OFFSITE` names an rsync destination: a local path (a share
 * mounted from somewhere else) or `host:path` over SSH. rsync because it is on
 * every machine this runs on, it moves only what changed -- clips are copied
 * once, not nightly -- and it checks a whole-file checksum on everything it
 * transfers. Credentials stay where SSH keeps them; the variable carries a
 * place, never a secret.
 *
 * Nothing here deletes at the destination. Pruning is local; the far copy
 * keeps what it was given, so a bad local prune cannot reach it.
 */

export const OFFSITE_ENV = "SNB_BACKUP_OFFSITE";

/** What is wrong with a destination, or null if it can be used. */
export function checkDestination(destination: string): string | null {
  const value = destination.trim();
  if (value === "") return `${OFFSITE_ENV} is empty.`;
  // rsync reads a leading dash as an option. The arguments are passed without
  // a shell, so this is the only way a destination could become a flag.
  if (value.startsWith("-")) return `${OFFSITE_ENV} must not start with "-".`;
  // `host:` alone is the remote home directory. Joining onto it would give
  // `host:/files/`, the remote root, so a path is required.
  if (/^[^/]*:$/.test(value)) return `${OFFSITE_ENV} names a host but no path. Use host:path.`;
  return null;
}

const under = (destination: string, ...parts: string[]) =>
  [destination.trim().replace(/\/+$/, ""), ...parts].join("/");

/**
 * The rsync runs that copy one dump, in order.
 *
 * Same rule as on local disk: a manifest at the destination means everything
 * it describes is already there. So the shared file store goes first, then
 * the dump without its manifest, then the manifest alone. A copy interrupted
 * at any point leaves a directory a restore refuses, never one it trusts.
 */
export function offsitePlan(root: string, dumpName: string, destination: string): string[][] {
  return [
    // Blobs mid-download are suffixed .partial; never carry one off.
    ["-a", "--exclude=*.partial", `${join(root, FILE_STORE)}/`, `${under(destination, FILE_STORE)}/`],
    ["-a", `--exclude=${MANIFEST}`, `${join(root, dumpName)}/`, `${under(destination, dumpName)}/`],
    ["-a", join(root, dumpName, MANIFEST), under(destination, dumpName, MANIFEST)],
  ];
}

/** Runs one rsync. Resolves with its exit code. */
export type Rsync = (args: string[]) => Promise<number>;

export async function copyOffsite(
  run: Rsync,
  root: string,
  dumpName: string,
  destination: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = checkDestination(destination);
  if (invalid) return { ok: false, message: invalid };

  const steps = offsitePlan(root, dumpName, destination);
  for (const [i, args] of steps.entries()) {
    const code = await run(args);
    // Stop at the first failure. Carrying on would send the manifest after a
    // failed blob copy -- a far copy that claims to be whole and is not.
    if (code !== 0) return { ok: false, message: `rsync step ${i + 1} of ${steps.length} exited ${code}.` };
  }
  return { ok: true };
}
