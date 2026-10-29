// @vitest-environment node
import { readTicket } from "@/lib/video/ticket";

/**
 * Minting playback URLs, with Appwrite replaced only at the JWT check. The
 * tickets are real, so a test can read one back and see who and what it was
 * minted for.
 */

const SECRET = "a-test-secret-that-is-long-enough-to-pass";
const COACH = "coach_ruairi";

// JWT -> user id. Anything else is an invalid token.
const tokens = vi.hoisted(() => new Map<string, string>());
const lookups = vi.hoisted(() => ({ count: 0 }));

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
    setJWT(jwt: string) {
      this.jwt = jwt;
      return this;
    }
  }
  class Account {
    constructor(private client: Client) {}
    async get() {
      lookups.count += 1;
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

const { POST } = await import("./route");

const post = (body: unknown, jwt?: string) =>
  POST(
    new Request("http://localhost/api/clip", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  tokens.clear();
  lookups.count = 0;
  tokens.set(`jwt-${COACH}`, COACH);
  vi.stubEnv("VIDEO_TICKET_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/clip — who is asking", () => {
  it("refuses a request with no JWT, before asking Appwrite", async () => {
    expect((await post({ fileIds: ["clip-a"] })).status).toBe(401);
    expect(lookups.count).toBe(0);
  });

  it("refuses a JWT Appwrite does not recognise", async () => {
    expect((await post({ fileIds: ["clip-a"] }, "jwt-forged")).status).toBe(401);
  });
});

describe("POST /api/clip — what it mints", () => {
  /**
   * Each URL carries a ticket for that file and the caller, so the stream
   * route can ask Appwrite as them. A ticket naming the wrong user would be
   * someone else's access.
   */
  it("returns one URL per file, each ticketed to that file and the caller", async () => {
    const response = await post({ fileIds: ["clip-a", "clip-b"] }, `jwt-${COACH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");

    const { urls } = (await response.json()) as { urls: Record<string, string> };
    expect(Object.keys(urls).sort()).toEqual(["clip-a", "clip-b"]);
    for (const [fileId, url] of Object.entries(urls)) {
      const parsed = new URL(url, "http://localhost");
      expect(parsed.pathname).toBe(`/api/clip/${fileId}`);
      expect(readTicket(parsed.searchParams.get("t")!, SECRET)).toMatchObject({ fileId, userId: COACH });
    }
  });
});

describe("POST /api/clip — a missing VIDEO_TICKET_SECRET", () => {
  /**
   * The stream route already says this in the log. The mint route used to
   * throw out of the handler instead: an unlogged 500 and a review screen
   * that only said the clip "could not be loaded".
   */
  it("answers a clean 500 and names the variable in the log", async () => {
    vi.stubEnv("VIDEO_TICKET_SECRET", "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await post({ fileIds: ["clip-a"] }, `jwt-${COACH}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("VIDEO_TICKET_SECRET");
  });
});

describe("POST /api/clip — proxies (v22)", () => {
  const urlsOf = async (body: unknown) =>
    ((await (await post(body, `jwt-${COACH}`)).json()) as { urls: Record<string, string> }).urls;
  const claimsOf = (url: string) => readTicket(decodeURIComponent(new URL(url, "http://x").searchParams.get("t")!), SECRET)!;

  it("keys the URL by the clip id but streams the clip's own proxy from the proxy bucket", async () => {
    const urls = await urlsOf({ fileIds: ["clip-a", "clip-b"], proxies: { "clip-a": "clip-a_proxy" } });
    expect(Object.keys(urls).sort()).toEqual(["clip-a", "clip-b"]);
    expect(urls["clip-a"]).toMatch(/^\/api\/clip\/clip-a_proxy\?t=/);
    expect(claimsOf(urls["clip-a"])).toMatchObject({ fileId: "clip-a_proxy", bucketId: "set_video_proxies", userId: COACH });
    // No proxy named: exactly the ticket an old server would mint.
    expect(urls["clip-b"]).toMatch(/^\/api\/clip\/clip-b\?t=/);
    expect(claimsOf(urls["clip-b"])).not.toHaveProperty("bucketId");
  });

  it("ignores a proxy that is not the clip's own, and a malformed proxies field", async () => {
    const wrong = await urlsOf({ fileIds: ["clip-a"], proxies: { "clip-a": "clip-z_proxy" } });
    expect(claimsOf(wrong["clip-a"])).toMatchObject({ fileId: "clip-a" });
    for (const proxies of [["clip-a_proxy"], "clip-a_proxy", null, 5]) {
      const urls = await urlsOf({ fileIds: ["clip-a"], proxies });
      expect(claimsOf(urls["clip-a"]).fileId).toBe("clip-a");
    }
  });

  it("reads only the proxies map's own keys", async () => {
    const urls = await urlsOf({ fileIds: ["toString"], proxies: {} });
    expect(claimsOf(urls["toString"]).fileId).toBe("toString");
  });
});
