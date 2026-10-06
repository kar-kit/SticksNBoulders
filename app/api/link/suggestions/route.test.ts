// @vitest-environment node
import type { SuggestionModeTables } from "@/appwrite/documents/suggestion-mode-admin";

/**
 * The route end to end, with Appwrite replaced at its two edges: the JWT
 * check (who is calling) and the admin tables (what the link rows say). The
 * authorisation logic in between is the real module, so these are tests of
 * who may flip the switch, not of a stub that agrees with itself.
 */

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const OTHER_COACH = "coach_louis";
const STRANGER = "user_stranger";
const REVOKED_COACH = "coach_former";

// JWT -> user id. Anything else is an invalid token.
const tokens = vi.hoisted(() => new Map<string, string>());

vi.mock("node-appwrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-appwrite")>();
  class Client {
    jwt = "";
    setEndpoint() {
      return this;
    }
    setProject() {
      return this;
    }
    setKey() {
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
      const id = tokens.get(this.client.jwt);
      if (!id) throw Object.assign(new Error("invalid jwt"), { code: 401 });
      return { $id: id };
    }
  }
  return { ...actual, Client, Account };
});

vi.mock("@/appwrite/env", () => ({
  serverAppwriteConfig: () => ({
    endpoint: "https://appwrite.test/v1",
    projectId: "p",
    apiKey: "k",
    databaseId: "sticksnboulders",
  }),
}));

interface Row extends Record<string, unknown> {
  $id: string;
}

const store = vi.hoisted(() => ({
  links: [] as Row[],
  updates: [] as Array<{ rowId: string; data?: Record<string, unknown>; permissions?: string[] }>,
  fail: false,
}));

vi.mock("@/appwrite/documents/suggestion-mode-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/appwrite/documents/suggestion-mode-admin")>();
  const tables: SuggestionModeTables = {
    async listRows({ tableId, queries }) {
      if (store.fail) throw new Error("appwrite down");
      if (tableId !== "coach_athlete_links") return { rows: [] };
      // Honours the equality filters the module sends, so a dropped filter is
      // a failing test rather than a permissive stub.
      const wanted = Object.fromEntries(
        queries
          .map((q) => JSON.parse(q) as { method?: string; attribute?: string; values?: unknown[] })
          .filter((q) => q.method === "equal" && q.attribute)
          .map((q) => [q.attribute as string, q.values?.[0]]),
      );
      return {
        rows: store.links.filter((row) => Object.entries(wanted).every(([key, value]) => row[key] === value)),
      };
    },
    writer: {
      async createRow() {
        throw new Error("a suggestion switch never creates a row");
      },
      async updateRow({ rowId, data, permissions }) {
        store.updates.push({ rowId, data, permissions });
        return { $id: rowId };
      },
      async deleteRow() {
        throw new Error("a suggestion switch never deletes a row");
      },
    },
  };
  return { ...actual, adminSuggestionModeTables: () => tables };
});

const { POST } = await import("./route");

const link = (coachId: string, athleteId: string, status: "active" | "revoked"): Row => ({
  $id: `link_${coachId}`,
  coach_id: coachId,
  athlete_id: athleteId,
  status,
});

const post = (body: unknown, jwt?: string) =>
  POST(
    new Request("http://localhost/api/link/suggestions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  tokens.clear();
  for (const id of [ATHLETE, COACH, OTHER_COACH, STRANGER, REVOKED_COACH]) tokens.set(`jwt-${id}`, id);
  store.links = [
    link(COACH, ATHLETE, "active"),
    link(REVOKED_COACH, ATHLETE, "revoked"),
    link(OTHER_COACH, "athlete_someone_else", "active"),
  ];
  store.updates = [];
  store.fail = false;
});

describe("POST /api/link/suggestions — who is calling", () => {
  it("refuses a request with no token, before reading anything", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "held" });
    expect(response.status).toBe(401);
    expect(store.updates).toEqual([]);
  });

  it("refuses a token Appwrite does not recognise", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "held" }, "jwt-forged");
    expect(response.status).toBe(401);
    expect(store.updates).toEqual([]);
  });
});

describe("POST /api/link/suggestions — who may set it", () => {
  it("lets the coach on an active link hold an athlete's suggestions", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "held" }, `jwt-${COACH}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "saved", mode: "held" });
    expect(store.updates).toEqual([
      {
        rowId: `link_${COACH}`,
        data: { suggestions_mode: "held" },
        permissions: [`read("user:${ATHLETE}")`, `read("user:${COACH}")`],
      },
    ]);
  });

  it("and switch them back to direct", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "direct" }, `jwt-${COACH}`);
    expect(response.status).toBe(200);
    expect(store.updates[0].data).toEqual({ suggestions_mode: "direct" });
  });

  it("refuses the athlete, even for their own link: it is the coach's switch", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "direct" }, `jwt-${ATHLETE}`);
    expect(response.status).toBe(403);
    expect(store.updates).toEqual([]);
  });

  it("refuses a coach whose link has been revoked", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "held" }, `jwt-${REVOKED_COACH}`);
    expect(response.status).toBe(403);
    expect(store.updates).toEqual([]);
  });

  it("refuses another coach, who has an active link with somebody else", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "held" }, `jwt-${OTHER_COACH}`);
    expect(response.status).toBe(403);
    expect(store.updates).toEqual([]);
  });

  it("refuses a stranger", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "held" }, `jwt-${STRANGER}`);
    expect(response.status).toBe(403);
    expect(store.updates).toEqual([]);
  });

  it("ignores a coach id in the body: the caller is the token, not a claim", async () => {
    const response = await post({ athleteId: ATHLETE, coachId: COACH, mode: "held" }, `jwt-${STRANGER}`);
    expect(response.status).toBe(403);
    expect(store.updates).toEqual([]);
  });

  it("refuses an unknown mode from the coach, and writes nothing", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "approve-each" }, `jwt-${COACH}`);
    expect(response.status).toBe(400);
    expect(store.updates).toEqual([]);
  });

  it("tells a stranger 403 for an unknown mode too, so the refusal leaks nothing", async () => {
    const response = await post({ athleteId: ATHLETE, mode: "approve-each" }, `jwt-${STRANGER}`);
    expect(response.status).toBe(403);
  });
});

describe("POST /api/link/suggestions — malformed requests", () => {
  it("refuses a body that is not JSON", async () => {
    expect((await post("not json", `jwt-${COACH}`)).status).toBe(400);
  });

  it("refuses a request that names no athlete", async () => {
    expect((await post({ mode: "held" }, `jwt-${COACH}`)).status).toBe(400);
    expect(store.updates).toEqual([]);
  });

  it("answers 500 rather than a false success when Appwrite cannot be read", async () => {
    store.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ athleteId: ATHLETE, mode: "held" }, `jwt-${COACH}`)).status).toBe(500);
    expect(store.updates).toEqual([]);
  });
});
