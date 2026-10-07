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

vi.mock("@/appwrite/server-client", () => ({ createServerClient: () => ({}) }));

vi.mock("@/appwrite/env", () => ({
  serverAppwriteConfig: () => ({
    endpoint: "https://appwrite.test/v1",
    projectId: "p",
    apiKey: "k",
    databaseId: "sticksnboulders",
  }),
}));

/** Storage: serves any file, as whoever's JWT it was given. */
const storage = vi.fn(async (_url: string, init: RequestInit) => {
  const headers = init.headers as Record<string, string>;
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
