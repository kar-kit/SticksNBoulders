import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * "No write path bypasses the helper" is the claim the whole permission model
 * rests on. ESLint enforces it at commit time; this asserts it as a property of
 * the tree, so the claim survives someone disabling a rule, and so a failure
 * says why rather than just naming a selector.
 */

const ROW_MUTATORS = [
  "createRow",
  "createRows",
  "updateRow",
  "updateRows",
  "upsertRow",
  "upsertRows",
  "deleteRow",
  "deleteRows",
  "incrementRowColumn",
  "decrementRowColumn",
];

/**
 * The working tree, not just the index. Untracked files are included -- an
 * uncommitted bypass is precisely the one this needs to catch -- while
 * gitignored paths like node_modules and build output are not.
 */
function sourceFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.ts", "*.tsx", "*.mts"],
    { encoding: "utf8" },
  );
  return [...new Set(out.split("\n").filter(Boolean))];
}

const ALLOWED_TO_WRITE_ROWS = [
  // The helper itself.
  /^appwrite\/documents\//,
  // Scripts run with an API key and are reviewed as scripts, not as
  // application write paths.
  /^scripts\//,
];

const callers = (file: string) => ALLOWED_TO_WRITE_ROWS.some((p) => p.test(file));

describe("the write helper is the only write path", () => {
  const files = sourceFiles();

  it("finds source files to check, so a broken glob cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("appwrite/documents/write.ts");
  });

  it.each(ROW_MUTATORS)("no file outside the helper calls %s", (method) => {
    const pattern = new RegExp(`\\.\\s*${method}\\s*\\(`);
    const offenders = files
      .filter((file) => !callers(file))
      .filter((file) => pattern.test(readFileSync(file, "utf8")));

    expect(
      offenders,
      `${offenders.join(", ")} calls ${method} directly. Route it through appwrite/documents ` +
        `so permissions and denormalised fields are stamped together.`,
    ).toEqual([]);
  });

  it("constructs TablesDB only where row writes or DDL happen", () => {
    const allowed = [/^appwrite\/documents\//, /^appwrite\/schema\//, /^scripts\//];
    const offenders = files
      .filter((file) => !allowed.some((p) => p.test(file)))
      .filter((file) => /new\s+TablesDB\s*\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps the API key out of anything the browser could bundle", () => {
    // A NEXT_PUBLIC_ prefix would ship the admin key to every athlete's phone.
    const offenders = files
      .filter((file) => file.startsWith("app/") || file.startsWith("components/"))
      .filter((file) => /APPWRITE_API_KEY/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("builds permission strings in the policy and nowhere else", () => {
    // A permission assembled at a call site is one nobody reviews again.
    const pattern = /["'`](read|update|delete)\(["'`]/;
    const offenders = files
      .filter((file) => !/^appwrite\/documents\//.test(file))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => pattern.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
