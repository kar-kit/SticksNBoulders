import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
  // A path can be in the index but not on disk -- a staged deletion, a
  // half-finished rebase. Reading it throws and takes the whole guard with it,
  // which turns a security check into a confusing crash at the worst moment.
  return [...new Set(out.split("\n").filter(Boolean))].filter((file) => existsSync(file));
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

  it("constructs TablesDB only where row writes, reads or DDL happen", () => {
    // browser-client constructs one for READS. Reads are not what this guard
    // protects -- the row-mutator ban above is, and it still covers that file.
    const allowed = [
      /^appwrite\/documents\//,
      /^appwrite\/schema\//,
      /^appwrite\/browser-client\.ts$/,
      /^scripts\//,
    ];
    const offenders = files
      .filter((file) => !allowed.some((p) => p.test(file)))
      .filter((file) => /new\s+TablesDB\s*\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("never gives a secret a NEXT_PUBLIC_ prefix", () => {
    // This is the leak that matters. Next inlines NEXT_PUBLIC_ values into the
    // client bundle, so prefixing the admin key would ship it to every
    // athlete's phone. A non-prefixed name is simply undefined in the browser.
    const offenders = files.filter((file) =>
      /NEXT_PUBLIC_\w*(API_KEY|SECRET|TOKEN|PASSWORD)/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("reads the API key only where the code is server-only", () => {
    // Route handlers and scripts never reach the browser. A client component
    // reaching for it would get undefined and fail confusingly at runtime.
    const serverOnly = [/^appwrite\//, /^scripts\//, /^app\/api\//];
    const offenders = files
      .filter((file) => !serverOnly.some((p) => p.test(file)))
      .filter((file) => /\bAPPWRITE_API_KEY\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps a client component from importing the admin client", () => {
    const offenders = files
      .filter((file) => file.startsWith("app/") || file.startsWith("components/"))
      .filter((file) => !file.startsWith("app/api/"))
      .filter((file) => /from "@\/appwrite\/server-client"/.test(readFileSync(file, "utf8")));
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
