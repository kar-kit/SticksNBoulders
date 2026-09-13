import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Appwrite stamps access per row at write time. There is no policy to audit,
 * only every write path -- so there is exactly one write path, and this is
 * what stops a second one appearing.
 *
 * A component that needs to write calls the helper. If the helper lacks the
 * operation, the operation is added there, with its policy, rather than
 * inlined at a call site nobody will review again.
 *
 * Note: flat config REPLACES a rule's options when a later block sets the same
 * rule, it does not merge them. So every variant below restates the full
 * selector list rather than adding to it -- splitting them across two blocks
 * silently disabled the row-mutator ban.
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

const rowMutatorSelectors = ROW_MUTATORS.map((method) => ({
  selector: `CallExpression > MemberExpression[property.name="${method}"]`,
  message: `Writes go through appwrite/documents (the write helper), never ${method} directly. It stamps permissions and denormalised fields together so they cannot drift; a write that skips it is a permissions bug waiting to happen.`,
}));

const tablesDbConstruction = {
  selector: 'NewExpression[callee.name="TablesDB"]',
  message:
    "Construct TablesDB inside appwrite/documents (row writes) or appwrite/schema (DDL) only. Elsewhere, take the helper's RowWriter so the write path stays auditable.",
};

const writeHelperGuard = {
  name: "snb/write-helper-guard",
  files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
  ignores: [
    // The helper itself, and the interface it writes through.
    "appwrite/documents/**",
    // Setup, reset and the permission probe run with an API key. They are
    // reviewed as scripts, not as application write paths.
    "scripts/**",
  ],
  rules: {
    "no-restricted-syntax": ["error", ...rowMutatorSelectors, tablesDbConstruction],
  },
};

/**
 * appwrite/schema does DDL -- tables, columns, indexes -- and never touches a
 * row, so it may construct TablesDB. The row-mutator ban still applies to it.
 */
const schemaDdlException = {
  name: "snb/write-helper-guard-ddl",
  files: ["appwrite/schema/**/*.ts"],
  rules: {
    "no-restricted-syntax": ["error", ...rowMutatorSelectors],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  writeHelperGuard,
  schemaDdlException,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".appwrite-backup/**"]),
]);

export default eslintConfig;
