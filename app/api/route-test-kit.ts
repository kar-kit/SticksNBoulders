/**
 * Appwrite, in memory, for the API route tests.
 *
 * Each route test replaces node-appwrite with `fakeNodeAppwrite` and nothing
 * else, so the route and the real admin module behind it run unchanged against
 * this. The fakes APPLY what they are sent -- a JWT resolves to exactly one
 * user, a query's filters narrow the rows -- because a stub that ignores its
 * arguments passes whatever the route forgot to ask for.
 *
 * Not a test file (no `.test.`), so vitest never runs it on its own. It must
 * not import node-appwrite: the mock factory imports this module, and a cycle
 * through the module being mocked never resolves.
 *
 * Usage, in a file marked `// @vitest-environment node`:
 *
 *   vi.mock("node-appwrite", async (actual) =>
 *     (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual()));
 *   vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);
 *   const { POST } = await import("./route");
 */

export type Row = Record<string, unknown> & { $id: string };

export interface Account {
  $id: string;
  name?: string;
  email?: string;
  /** The hash, as the admin Users API carries it. Absent for a provider-only account. */
  password?: string;
}

export interface Write {
  op: "create" | "update" | "delete";
  tableId: string;
  rowId: string;
  data?: Record<string, unknown>;
  permissions?: string[];
}

/** Everything the fake instance holds. Reset by `resetAppwrite()` before each test. */
export const appwrite = {
  /** JWT -> account. Any other token is invalid. */
  sessions: new Map<string, Account>(),
  /** The admin user directory, for the method hint. */
  users: [] as Account[],
  identities: [] as Array<{ userId: string; provider: string }>,
  tables: {} as Record<string, Row[]>,
  /** Team id -> member user ids, with the role each holds. */
  teams: {} as Record<string, Array<{ userId: string; roles: string[] }>>,
  writes: [] as Write[],
  /** Every TablesDB call made without the API key. Should stay empty. */
  keylessCalls: [] as string[],
};

export function resetAppwrite(): void {
  appwrite.sessions.clear();
  appwrite.users = [];
  appwrite.identities = [];
  appwrite.tables = {};
  appwrite.teams = {};
  appwrite.writes = [];
  appwrite.keylessCalls = [];
}

/** Signs a user in and returns the JWT that proves it. */
export function jwtFor(account: Account | string): string {
  const acct = typeof account === "string" ? { $id: account } : account;
  const jwt = `jwt-${acct.$id}`;
  appwrite.sessions.set(jwt, acct);
  return jwt;
}

export const fakeEnv = {
  serverAppwriteConfig: () => ({
    endpoint: "https://appwrite.test/v1",
    projectId: "p",
    apiKey: "server-key",
    databaseId: "sticksnboulders",
  }),
};

let address = 0;

/**
 * A request to a route. Each gets its own caller address unless one is given,
 * so the per-address limiters only fire in the tests that are about them.
 */
export function routeRequest(
  url: string,
  options: { method?: string; jwt?: string; body?: unknown; ip?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `10.0.${Math.floor(++address / 250)}.${address % 250}`,
  };
  if (options.jwt) headers.authorization = `Bearer ${options.jwt}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${url}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
}

/* -------------------------------------------------------------------------
 * Queries
 * ---------------------------------------------------------------------- */

interface ParsedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

/** Methods that shape a page rather than filter it. */
const NON_FILTERS = new Set(["limit", "offset", "orderAsc", "orderDesc", "select", "cursorAfter", "cursorBefore"]);

/**
 * Applies a query list the way Appwrite would, for the methods these routes
 * send. An unknown filter throws: silently passing a row it could not judge
 * is exactly the permissive stub this file exists to avoid.
 */
export function applyQueries(rows: Row[], queries: string[] = []): Row[] {
  const parsed = queries.map((q) => JSON.parse(q) as ParsedQuery);
  let out = rows.filter((row) =>
    parsed.every((q) => {
      const value = q.attribute ? row[q.attribute] : undefined;
      switch (q.method) {
        case "equal":
          return (q.values ?? []).includes(value);
        case "greaterThanEqual":
          return String(value) >= String(q.values?.[0]);
        case "lessThan":
          return String(value) < String(q.values?.[0]);
        default:
          if (NON_FILTERS.has(q.method)) return true;
          throw new Error(`route-test-kit: no fake for Query.${q.method}`);
      }
    }),
  );
  const order = parsed.find((q) => q.method === "orderAsc");
  if (order?.attribute) {
    const key = order.attribute;
    out = [...out].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  }
  const limit = parsed.find((q) => q.method === "limit");
  // Appwrite's page is 25 rows when no limit is sent.
  return out.slice(0, Number(limit?.values?.[0] ?? 25));
}

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { code: 404 });

/* -------------------------------------------------------------------------
 * node-appwrite
 * ---------------------------------------------------------------------- */

/** Replaces the SDK's network-facing classes; keeps Query, ID and the rest real. */
export function fakeNodeAppwrite<T extends object>(actual: T) {
  class Client {
    jwt = "";
    key = "";
    setEndpoint() {
      return this;
    }
    setProject() {
      return this;
    }
    setKey(key: string) {
      this.key = key;
      return this;
    }
    setJWT(jwt: string) {
      this.jwt = jwt;
      return this;
    }
  }

  class Account {
    constructor(private client: Client) {}
    async get() {
      const account = appwrite.sessions.get(this.client.jwt);
      if (!account) throw Object.assign(new Error("invalid jwt"), { code: 401 });
      return { name: "", email: "", ...account };
    }
  }

  /** Admin-only services refuse a client without the API key, as Appwrite does. */
  const admin = (client: Client, call: string) => {
    if (!client.key) {
      appwrite.keylessCalls.push(call);
      throw Object.assign(new Error(`${call} needs the API key`), { code: 401 });
    }
  };

  class TablesDB {
    constructor(private client: Client) {}
    async listRows({ tableId, queries }: { tableId: string; queries?: string[] }) {
      admin(this.client, "listRows");
      const rows = applyQueries(appwrite.tables[tableId] ?? [], queries).map((row) => ({ ...row }));
      return { total: rows.length, rows };
    }
    async getRow({ tableId, rowId }: { tableId: string; rowId: string }) {
      admin(this.client, "getRow");
      const row = (appwrite.tables[tableId] ?? []).find((r) => r.$id === rowId);
      if (!row) throw notFound("row");
      return { ...row };
    }
    async createRow(p: { tableId: string; rowId: string; data: Record<string, unknown>; permissions?: string[] }) {
      admin(this.client, "createRow");
      // The row id is unique per table; Appwrite answers a duplicate with 409.
      if ((appwrite.tables[p.tableId] ?? []).some((r) => r.$id === p.rowId)) {
        throw Object.assign(new Error("row already exists"), { code: 409 });
      }
      appwrite.writes.push({ op: "create", tableId: p.tableId, rowId: p.rowId, data: p.data, permissions: p.permissions });
      const row: Row = { ...p.data, $id: p.rowId, $permissions: p.permissions ?? [] };
      (appwrite.tables[p.tableId] ??= []).push(row);
      return { ...row };
    }
    async updateRow(p: { tableId: string; rowId: string; data?: Record<string, unknown>; permissions?: string[] }) {
      admin(this.client, "updateRow");
      appwrite.writes.push({ op: "update", tableId: p.tableId, rowId: p.rowId, data: p.data, permissions: p.permissions });
      const row = (appwrite.tables[p.tableId] ?? []).find((r) => r.$id === p.rowId);
      if (!row) throw notFound("row");
      for (const [key, value] of Object.entries(p.data ?? {})) if (value !== undefined) row[key] = value;
      if (p.permissions) row.$permissions = p.permissions;
      return { ...row };
    }
    async deleteRow({ tableId, rowId }: { tableId: string; rowId: string }) {
      admin(this.client, "deleteRow");
      appwrite.writes.push({ op: "delete", tableId, rowId });
      appwrite.tables[tableId] = (appwrite.tables[tableId] ?? []).filter((r) => r.$id !== rowId);
      return {};
    }
  }

  class Teams {
    constructor(private client: Client) {}
    async get({ teamId }: { teamId: string }) {
      admin(this.client, "teams.get");
      if (!appwrite.teams[teamId]) throw notFound("team");
      return { $id: teamId };
    }
    async create({ teamId }: { teamId: string }) {
      admin(this.client, "teams.create");
      appwrite.teams[teamId] ??= [];
      return { $id: teamId };
    }
    async createMembership({ teamId, userId, roles }: { teamId: string; userId: string; roles: string[] }) {
      admin(this.client, "teams.createMembership");
      if (!appwrite.teams[teamId]) throw notFound("team");
      appwrite.teams[teamId].push({ userId, roles });
      return { $id: `m_${userId}` };
    }
    async listMemberships({ teamId }: { teamId: string }) {
      admin(this.client, "teams.listMemberships");
      if (!appwrite.teams[teamId]) throw notFound("team");
      return { memberships: appwrite.teams[teamId].map((m) => ({ $id: `m_${m.userId}`, ...m })) };
    }
    async deleteMembership({ teamId, membershipId }: { teamId: string; membershipId: string }) {
      admin(this.client, "teams.deleteMembership");
      appwrite.teams[teamId] = (appwrite.teams[teamId] ?? []).filter((m) => `m_${m.userId}` !== membershipId);
      return {};
    }
  }

  class Users {
    constructor(private client: Client) {}
    async get({ userId }: { userId: string }) {
      admin(this.client, "users.get");
      const user = appwrite.users.find((u) => u.$id === userId) ?? [...appwrite.sessions.values()].find((u) => u.$id === userId);
      if (!user) throw notFound("user");
      return { name: "", email: "", ...user };
    }
    async list({ queries }: { queries?: string[] } = {}) {
      admin(this.client, "users.list");
      const users = applyQueries(appwrite.users as Row[], queries);
      return { total: users.length, users };
    }
    async listIdentities({ queries }: { queries?: string[] } = {}) {
      admin(this.client, "users.listIdentities");
      const identities = applyQueries(
        appwrite.identities.map((i, n) => ({ $id: `identity_${n}`, ...i })),
        queries,
      );
      return { total: identities.length, identities };
    }
  }

  return { ...actual, Client, Account, TablesDB, Teams, Users };
}
