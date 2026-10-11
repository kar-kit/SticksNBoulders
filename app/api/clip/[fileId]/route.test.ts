// @vitest-environment node
import { mintTicket, TICKET_TTL_MS } from "@/lib/video/ticket";

/**
 * The stream route with Appwrite replaced at its two edges: the admin call
 * that mints a JWT for the ticket's user, and the storage fetch made as them.
 * Tickets are minted for real, so these test what a URL actually opens.
 */

const SECRET = "a-test-secret-that-is-long-enough-to-pass";
const COACH = "coach_ruairi";

const appwrite = vi.hoisted(() => ({ jwtFails: false, jwtFor: [] as string[] }));

vi.mock("node-appwrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node-appwrite")>();
  class Users {
    async createJWT({ userId }: { userId: string }) {
      if (appwrite.jwtFails) throw new Error("user not found");
      appwrite.jwtFor.push(userId);
      return { jwt: `jwt-for-${userId}` };
    }
  }
  return { ...actual, Users };
});

/** The admin-key client. Spied, so a test can say when the key came into play. */
const createServerClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@/appwrite/server-client", () => ({ createServerClient }));

vi.mock("@/appwrite/env", () => ({
  serverAppwriteConfig: () => ({
    endpoint: "https://appwrite.test/v1",
    projectId: "p",
    apiKey: "k",
    databaseId: "sticksnboulders",
  }),
}));

/**
 * Storage with permissions, the way Appwrite has them: the API key reads
 * every file, a user's JWT reads only the files that user may read, and
 * anything else is refused. A fake that serves any file to anyone cannot tell
 * "asked as the user" from "asked as the admin", which is the difference that
 * matters here (test audit C07).
 */
const OTHER_ATHLETES_CLIP = "clip-not-yours";
const readers: Record<string, string[]> = {
  "clip-a": [COACH],
  "clip-b": [COACH],
  [OTHER_ATHLETES_CLIP]: ["athlete_somebody_else"],
};

const storage = vi.fn(async (url: string, init: RequestInit) => {
  const headers = init.headers as Record<string, string>;
  const fileId = decodeURIComponent(/\/files\/([^/]+)\/view$/.exec(url)![1]);
  const asAdmin = Object.keys(headers).some((name) => name.toLowerCase() === "x-appwrite-key");
  const jwtUser = headers["x-appwrite-jwt"]?.replace(/^jwt-for-/, "");

  if (!asAdmin && !jwtUser) {
    return Response.json({ message: "missing scope", type: "user_unauthorized" }, { status: 401 });
  }
  if (!asAdmin && !(readers[fileId] ?? []).includes(jwtUser!)) {
    return Response.json(
      { message: "The requested file could not be found.", type: "storage_file_not_found" },
      { status: 404 },
    );
  }
  return new Response("video-bytes", {
    status: headers.range ? 206 : 200,
    headers: {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      ...(headers.range ? { "content-range": "bytes 0-10/1000" } : {}),
    },
  });
});

const { GET } = await import("./route");

const ticket = (fileId: string, expiresAt = Date.now() + TICKET_TTL_MS) =>
  mintTicket({ fileId, userId: COACH, expiresAt }, SECRET);

const get = (fileId: string, token: string | null, range?: string) =>
  GET(
    new Request(`http://localhost/api/clip/${fileId}${token === null ? "" : `?t=${encodeURIComponent(token)}`}`, {
      headers: range ? { range } : {},
    }),
    { params: Promise.resolve({ fileId }) },
  );

beforeEach(() => {
  appwrite.jwtFails = false;
  appwrite.jwtFor = [];
  storage.mockClear();
  createServerClient.mockClear();
  vi.stubGlobal("fetch", storage);
  vi.stubEnv("VIDEO_TICKET_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/clip/[fileId] — a good ticket", () => {
  it("streams the file as the ticket's user, forwarding the range", async () => {
    const response = await get("clip-a", ticket("clip-a"), "bytes=0-10");

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-10/1000");
    expect(await response.text()).toBe("video-bytes");
    expect(appwrite.jwtFor).toEqual([COACH]);

    const [url, init] = storage.mock.calls[0];
    expect(url).toBe("https://appwrite.test/v1/storage/buckets/set_videos/files/clip-a/view");
    expect(init.headers).toMatchObject({ "x-appwrite-jwt": `jwt-for-${COACH}`, range: "bytes=0-10" });
  });

  /**
   * The admin key mints the user's JWT and nothing else. Sent on the storage
   * read as well, the route stops being a pipe and becomes a gate-less admin
   * read: any ticket would stream any file. Exact equality, because
   * `toMatchObject` above ignores an extra header.
   */
  it("asks Appwrite as the user and never with the API key", async () => {
    await get("clip-a", ticket("clip-a"), "bytes=0-10");

    const headers = storage.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("x-appwrite-key");
    expect(headers).toEqual({
      "x-appwrite-project": "p",
      "x-appwrite-jwt": `jwt-for-${COACH}`,
      "accept-encoding": "identity",
      range: "bytes=0-10",
    });
  });

  it("is never cached and never sniffed", async () => {
    const response = await get("clip-a", ticket("clip-a"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("forwards only the range, type and length headers", async () => {
    storage.mockImplementationOnce(
      async () =>
        new Response("video-bytes", {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": "11",
            "set-cookie": "a_session_p=secret",
            "x-appwrite-session": "secret",
          },
        }),
    );

    const response = await get("clip-a", ticket("clip-a"));

    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("11");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-appwrite-session")).toBeNull();
  });
});

describe("GET /api/clip/[fileId] — a good ticket for a clip its holder may not read", () => {
  /**
   * `/api/clip` mints a ticket for any file id a signed-in user names, so a
   * valid ticket is no evidence of access. What stops it is that the bytes
   * are fetched as the ticket's user and Appwrite refuses them.
   */
  it("streams nothing, and says no more than 404", async () => {
    const response = await get(OTHER_ATHLETES_CLIP, ticket(OTHER_ATHLETES_CLIP));

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain("video-bytes");
    expect(body).not.toContain("storage_file_not_found");
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("answers 404 with no upstream body when Appwrite refuses the JWT", async () => {
    storage.mockImplementationOnce(async () =>
      Response.json({ message: "Invalid token", type: "user_unauthorized" }, { status: 401 }),
    );

    const response = await get("clip-a", ticket("clip-a"));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("user_unauthorized");
  });
});

describe("GET /api/clip/[fileId] — a ticket that does not open this file", () => {
  /**
   * The ticket names one file. Without the comparison, one ticket for clip A
   * would open every clip in the bucket the holder can read, by editing the
   * path -- including ones never minted for them.
   */
  it("refuses a ticket for file A on the path of file B, without fetching anything", async () => {
    const response = await get("clip-b", ticket("clip-a"));

    expect(response.status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
    expect(appwrite.jwtFor).toEqual([]);
  });

  it("refuses an expired ticket", async () => {
    const response = await get("clip-a", ticket("clip-a", Date.now() - 1));
    expect(response.status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  it("refuses a request with no ticket", async () => {
    expect((await get("clip-a", null)).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  it("refuses a ticket signed with another secret", async () => {
    const forged = mintTicket(
      { fileId: "clip-a", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS },
      "a-different-secret-also-long-enough-here",
    );
    expect((await get("clip-a", forged)).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  it("refuses a ticket whose payload was edited to name another file", async () => {
    const [, signature] = ticket("clip-a").split(".");
    const payload = Buffer.from(
      JSON.stringify({ fileId: "clip-b", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS }),
    ).toString("base64url");

    expect((await get("clip-b", `${payload}.${signature}`)).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });

  /**
   * The admin key comes into play only once the ticket has been verified for
   * the file on the path. A refused ticket costs nothing privileged: no admin
   * client, no JWT minted for anyone.
   */
  it.each([
    ["no ticket", () => get("clip-a", null)],
    ["an expired ticket", () => get("clip-a", ticket("clip-a", Date.now() - 1))],
    ["a ticket for another file", () => get("clip-b", ticket("clip-a"))],
    [
      "a forged ticket",
      () =>
        get(
          "clip-a",
          mintTicket(
            { fileId: "clip-a", userId: COACH, expiresAt: Date.now() + TICKET_TTL_MS },
            "a-different-secret-also-long-enough-here",
          ),
        ),
    ],
    ["a malformed ticket", () => get("clip-a", "not-a-ticket")],
  ])("never touches the admin key for %s", async (_name, request) => {
    expect((await request()).status).toBe(404);
    expect(createServerClient).not.toHaveBeenCalled();
    expect(appwrite.jwtFor).toEqual([]);
  });

  it("mints the JWT for the ticket's user, once, after the ticket checks out", async () => {
    await get("clip-a", ticket("clip-a"));

    expect(createServerClient).toHaveBeenCalledTimes(1);
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("takes the user from the signed ticket, never from the rest of the URL", async () => {
    const victim = "athlete_somebody_else";
    const token = encodeURIComponent(ticket(OTHER_ATHLETES_CLIP));
    const response = await GET(
      new Request(
        `http://localhost/api/clip/${OTHER_ATHLETES_CLIP}?t=${token}&u=${victim}&user=${victim}&userId=${victim}`,
      ),
      { params: Promise.resolve({ fileId: OTHER_ATHLETES_CLIP }) },
    );

    expect(response.status).toBe(404);
    expect(appwrite.jwtFor).toEqual([COACH]);
  });

  it("answers 404 when a JWT cannot be minted for the ticket's user", async () => {
    appwrite.jwtFails = true;
    expect((await get("clip-a", ticket("clip-a"))).status).toBe(404);
    expect(storage).not.toHaveBeenCalled();
  });
});

describe("GET /api/clip/[fileId] — a missing VIDEO_TICKET_SECRET", () => {
  it("answers a clean 500 and names the variable in the log", async () => {
    vi.stubEnv("VIDEO_TICKET_SECRET", "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await get("clip-a", ticket("clip-a"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("VIDEO_TICKET_SECRET");
  });
});
