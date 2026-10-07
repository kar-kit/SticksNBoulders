import { checkDestination, copyOffsite, offsitePlan } from "./offsite";

const DUMP = "2026-10-07T03-15-00-000Z";

describe("checking an offsite destination", () => {
  it("accepts a mounted path and an SSH host:path", () => {
    expect(checkDestination("/mnt/offsite/snb")).toBeNull();
    expect(checkDestination("backup-box:snb")).toBeNull();
    expect(checkDestination("joey@backup-box:/srv/snb/")).toBeNull();
  });

  it("refuses an empty destination", () => {
    expect(checkDestination("  ")).toMatch(/empty/);
  });

  it("refuses one rsync would read as an option", () => {
    expect(checkDestination("--delete")).toMatch(/must not start with "-"/);
  });

  it("refuses a bare host, which would put the files at the remote root", () => {
    expect(checkDestination("backup-box:")).toMatch(/no path/);
  });
});

describe("the copy plan", () => {
  it("sends the clips, then the dump, then its manifest last", () => {
    // Same rule as on local disk: a manifest at the far end means everything
    // it describes is already there.
    expect(offsitePlan(".appwrite-backup", DUMP, "box:snb/")).toEqual([
      ["-a", "--exclude=*.partial", ".appwrite-backup/files/", "box:snb/files/"],
      ["-a", "--exclude=manifest.json", `.appwrite-backup/${DUMP}/`, `box:snb/${DUMP}/`],
      ["-a", `.appwrite-backup/${DUMP}/manifest.json`, `box:snb/${DUMP}/manifest.json`],
    ]);
  });

  it("never asks rsync to delete anything at the destination", () => {
    const flags = offsitePlan(".appwrite-backup", DUMP, "/mnt/offsite").flat();
    expect(flags.some((f) => f.startsWith("--delete") || f.startsWith("--remove"))).toBe(false);
  });
});

describe("copying offsite", () => {
  it("runs every step and reports success", async () => {
    const runs: string[][] = [];
    const result = await copyOffsite(async (args) => (runs.push(args), 0), ".appwrite-backup", DUMP, "/mnt/offsite");
    expect(result).toEqual({ ok: true });
    expect(runs).toHaveLength(3);
  });

  it("stops at the first failure, so the manifest never follows a failed copy", async () => {
    const runs: string[][] = [];
    const result = await copyOffsite(
      async (args) => (runs.push(args), runs.length === 1 ? 23 : 0),
      ".appwrite-backup",
      DUMP,
      "/mnt/offsite",
    );
    expect(result).toEqual({ ok: false, message: "rsync step 1 of 3 exited 23." });
    expect(runs).toHaveLength(1);
  });

  it("runs nothing for a destination it refuses", async () => {
    const runs: string[][] = [];
    const result = await copyOffsite(async (args) => (runs.push(args), 0), ".appwrite-backup", DUMP, "-e sh");
    expect(result.ok).toBe(false);
    expect(runs).toEqual([]);
  });
});
